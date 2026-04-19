import json
import struct
import os
import sys

DEFAULT_IMAGE_ASSET_REFS = {
    'rectangle': 100001,
    'ellipse': 100002,
    'triangle': 100003,
    'four_point_star': 100004,
    'five_point_star': 100005,
}

# ==========================================
# GIA Mode Constants
# ==========================================
MODE_DECORATION = 'decoration'  # kind=14, class=28 (旧链路: decoration节点)
MODE_IMAGE = 'image'            # kind=8, class=15 (新链路: UI image节点)

# ==========================================
# Minimal Protobuf Encoder/Decoder
# ==========================================

class WireType:
    VARINT = 0
    FIXED64 = 1
    LENGTH_DELIMITED = 2
    START_GROUP = 3
    END_GROUP = 4
    FIXED32 = 5

class ProtoReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def read_varint(self):
        result = 0
        shift = 0
        while True:
            if self.pos >= len(self.data):
                raise IndexError("End of data while reading varint")
            byte = self.data[self.pos]
            self.pos += 1
            result |= (byte & 0x7f) << shift
            if not (byte & 0x80):
                return result
            shift += 7

    def read_fixed32(self):
        if self.pos + 4 > len(self.data):
            raise IndexError("End of data while reading fixed32")
        val = self.data[self.pos:self.pos+4]
        self.pos += 4
        return val

    def read_fixed64(self):
        if self.pos + 8 > len(self.data):
            raise IndexError("End of data while reading fixed64")
        val = self.data[self.pos:self.pos+8]
        self.pos += 8
        return val

    def read_length_delimited(self):
        length = self.read_varint()
        if self.pos + length > len(self.data):
            raise IndexError("End of data while reading length delimited")
        val = self.data[self.pos:self.pos+length]
        self.pos += length
        return val

    def eof(self):
        return self.pos >= len(self.data)

    def read_tag(self):
        if self.eof(): return None, None
        val = self.read_varint()
        field_id = val >> 3
        wire_type = val & 0x07
        return field_id, wire_type

    def read_field(self, wire_type):
        if wire_type == WireType.VARINT:
            return self.read_varint()
        elif wire_type == WireType.FIXED64:
            return self.read_fixed64()
        elif wire_type == WireType.LENGTH_DELIMITED:
            return self.read_length_delimited()
        elif wire_type == WireType.FIXED32:
            return self.read_fixed32()
        else:
            raise ValueError(f"Unsupported wire type: {wire_type}")

class ProtoWriter:
    def __init__(self):
        self.buffer = bytearray()

    def write_varint(self, value):
        while True:
            byte = value & 0x7f
            value >>= 7
            if value:
                self.buffer.append(byte | 0x80)
            else:
                self.buffer.append(byte)
                break

    def write_tag(self, field_id, wire_type):
        val = (field_id << 3) | wire_type
        self.write_varint(val)

    def write_int32(self, field_id, value):
        self.write_tag(field_id, WireType.VARINT)
        # Handle negative numbers for varint (protobuf uses unsigned varint for int32 usually, 
        # but for negative int32/64 it actually writes 10 bytes 2's complement)
        if value < 0:
            value += (1 << 64)
        self.write_varint(value)
        
    def write_int64(self, field_id, value):
        self.write_tag(field_id, WireType.VARINT)
        if value < 0:
            value += (1 << 64)
        self.write_varint(value)

    def write_bool(self, field_id, value):
        self.write_tag(field_id, WireType.VARINT)
        self.write_varint(1 if value else 0)

    def write_float(self, field_id, value):
        self.write_tag(field_id, WireType.FIXED32)
        self.buffer.extend(struct.pack('<f', value))

    def write_string(self, field_id, value):
        encoded = value.encode('utf-8')
        self.write_tag(field_id, WireType.LENGTH_DELIMITED)
        self.write_varint(len(encoded))
        self.buffer.extend(encoded)

    def write_bytes(self, field_id, value):
        self.write_tag(field_id, WireType.LENGTH_DELIMITED)
        self.write_varint(len(value))
        self.buffer.extend(value)

    def write_message(self, field_id, writer):
        data = writer.buffer
        self.write_tag(field_id, WireType.LENGTH_DELIMITED)
        self.write_varint(len(data))
        self.buffer.extend(data)
        
    def get_bytes(self):
        return bytes(self.buffer)

# ==========================================
# GIA Specific Logic
# ==========================================

def parse_resource_entry(data):
    """ Parses enough of ResourceEntry to get identity and resource_class """
    reader = ProtoReader(data)
    info = {'class': 0, 'guid': 0, 'name': ''}
    
    while not reader.eof():
        tag, wire = reader.read_tag()
        if tag is None: break
        
        val = reader.read_field(wire)
        
        if tag == 5 and wire == WireType.VARINT: # resource_class
            info['class'] = val
        elif tag == 3 and wire == WireType.LENGTH_DELIMITED: # internal_name
            info['name'] = val.decode('utf-8', errors='ignore')
        elif tag == 1 and wire == WireType.LENGTH_DELIMITED: # identity
            # Parse identity (ResourceLocator)
            sub_reader = ProtoReader(val)
            while not sub_reader.eof():
                sub_tag, sub_wire = sub_reader.read_tag()
                sub_val = sub_reader.read_field(sub_wire)
                if sub_tag == 4 and sub_wire == WireType.VARINT: # asset_guid
                    info['guid'] = sub_val
                    
    return info

def parse_primary_resource(data):
    """ 
    Parses primary resource to rebuild it without removed references.
    Returns a list of fields (tag, wire, value_bytes).
    We need to parse references (tag 2) to filter them.
    """
    reader = ProtoReader(data)
    fields = []
    
    while not reader.eof():
        tag, wire = reader.read_tag()
        if tag is None: break
        
        start_pos = reader.pos
        # We need to capture the raw bytes of the value to write it back exactly if needed
        # But read_field returns parsed value. 
        # Hack: use internal pos to slice data.
        
        # But for LengthDelimited, we need to read length first.
        # Let's just use read_field and re-encode if simple, or keep raw if complex.
        # Actually, for reference_list (Tag 2), it is a ResourceLocator.
        # We need to inspect it.
        
        if wire == WireType.LENGTH_DELIMITED:
            length = reader.read_varint() # parsing length moves pos
            content = reader.data[reader.pos : reader.pos + length]
            reader.pos += length
            fields.append({'tag': tag, 'wire': wire, 'data': content})
        elif wire == WireType.VARINT:
            val = reader.read_varint()
            fields.append({'tag': tag, 'wire': wire, 'value': val})
        elif wire == WireType.FIXED32:
            val = reader.read_fixed32()
            fields.append({'tag': tag, 'wire': wire, 'raw': val})
        elif wire == WireType.FIXED64:
            val = reader.read_fixed64()
            fields.append({'tag': tag, 'wire': wire, 'raw': val})
            
    return fields

def check_locator_guid(data):
    reader = ProtoReader(data)
    while not reader.eof():
        tag, wire = reader.read_tag()
        val = reader.read_field(wire)
        if tag == 4 and wire == WireType.VARINT:
            return val
    return 0

def parse_message_fields(data):
    reader = ProtoReader(data)
    fields = []
    while not reader.eof():
        tag, wire = reader.read_tag()
        if tag is None:
            break
        if wire == WireType.LENGTH_DELIMITED:
            length = reader.read_varint()
            content = reader.data[reader.pos : reader.pos + length]
            reader.pos += length
            fields.append({'tag': tag, 'wire': wire, 'data': content})
        elif wire == WireType.VARINT:
            fields.append({'tag': tag, 'wire': wire, 'value': reader.read_varint()})
        elif wire == WireType.FIXED32:
            fields.append({'tag': tag, 'wire': wire, 'raw': reader.read_fixed32()})
        elif wire == WireType.FIXED64:
            fields.append({'tag': tag, 'wire': wire, 'raw': reader.read_fixed64()})
    return fields

def build_message(fields):
    writer = ProtoWriter()
    for f in fields:
        tag = f['tag']
        wire = f['wire']
        if wire == WireType.LENGTH_DELIMITED:
            data = f['data']
            writer.write_tag(tag, WireType.LENGTH_DELIMITED)
            writer.write_varint(len(data))
            writer.buffer.extend(data)
        elif wire == WireType.VARINT:
            writer.write_tag(tag, WireType.VARINT)
            writer.write_varint(f['value'])
        elif wire == WireType.FIXED32:
            writer.write_tag(tag, WireType.FIXED32)
            writer.buffer.extend(f['raw'])
        elif wire == WireType.FIXED64:
            writer.write_tag(tag, WireType.FIXED64)
            writer.buffer.extend(f['raw'])
    return writer.get_bytes()

def encode_packed_varints(values):
    w = ProtoWriter()
    for v in values:
        w.write_varint(int(v))
    return w.get_bytes()

def patch_prefab_guid_list(prefab_bytes, decoration_guids):
    prefab_fields = parse_message_fields(prefab_bytes)
    for pf in prefab_fields:
        if pf['tag'] != 1 or pf['wire'] != WireType.LENGTH_DELIMITED:
            continue
        inner_fields = parse_message_fields(pf['data'])
        for inner_f in inner_fields:
            if inner_f['wire'] != WireType.LENGTH_DELIMITED:
                continue
            comp_fields = parse_message_fields(inner_f['data'])
            component_id = None
            payload_50 = None
            for cf in comp_fields:
                if cf['tag'] == 1 and cf['wire'] == WireType.VARINT:
                    component_id = cf['value']
                if cf['tag'] == 50 and cf['wire'] == WireType.LENGTH_DELIMITED:
                    payload_50 = cf
            if component_id != 40 or payload_50 is None:
                continue
            p50_fields = parse_message_fields(payload_50['data'])
            for p50_f in p50_fields:
                if p50_f['tag'] == 501 and p50_f['wire'] == WireType.LENGTH_DELIMITED:
                    p50_f['data'] = encode_packed_varints(decoration_guids)
                    payload_50['data'] = build_message(p50_fields)
                    inner_f['data'] = build_message(comp_fields)
                    pf['data'] = build_message(inner_fields)
                    return build_message(prefab_fields)
    return prefab_bytes

def create_decoration_payload(guid, name, type_id, parent_guid, pos, scale, rot_z=0.0, rot_y=0.0):
    inner = ProtoWriter()
    
    inner.write_int64(1, guid)
    inner.write_int64(2, type_id)
    inner.write_int32(3, 1)
    
    c4_name = ProtoWriter()
    c4_name.write_int32(1, 1)
    
    p11 = ProtoWriter()
    p11.write_string(1, name)
    c4_name.write_message(11, p11)
    
    inner.write_message(4, c4_name)
    
    c4_parent = ProtoWriter()
    c4_parent.write_int32(1, 40)
    
    p50 = ProtoWriter()
    map_entry = ProtoWriter()
    map_entry.write_int32(1, 502)
    map_entry.write_int64(2, parent_guid)
    p50.write_message(502, map_entry)
    
    c4_parent.write_message(50, p50)
    inner.write_message(4, c4_parent)

    c5_trans = ProtoWriter()
    c5_trans.write_int32(1, 1)
    
    p11_trans = ProtoWriter()
    
    # Pos (x=1)
    vec_pos = ProtoWriter()
    vec_pos.write_float(1, pos['x'])
    vec_pos.write_float(2, pos['y'])
    vec_pos.write_float(3, 0.0)
    p11_trans.write_message(1, vec_pos)
    rot_z = float(rot_z or 0.0)
    rot_y = float(rot_y or 0.0)
    
    # 旋转：支持Z轴和Y轴旋转
    if abs(rot_z) < 1e-6 and abs(rot_y) < 1e-6:
        p11_trans.write_bytes(2, b'')
    else:
        vec_rot = ProtoWriter()
        # Z轴旋转
        vec_rot.write_float(3, rot_z)
        # Y轴旋转
        vec_rot.write_float(2, rot_y)
        p11_trans.write_message(2, vec_rot)
    
    # Scale (z=3)
    vec_scale = ProtoWriter()
    vec_scale.write_float(1, scale['x'])
    vec_scale.write_float(2, scale['y'])
    vec_scale.write_float(3, 1.0)
    p11_trans.write_message(3, vec_scale)
    
    c5_trans.write_message(11, p11_trans)
    inner.write_message(5, c5_trans)
    
    # Component 5 (Active)
    c5_active = ProtoWriter()
    c5_active.write_int32(1, 5)
    p15 = ProtoWriter()
    p15.write_int32(1, 1)
    p15.write_int32(2, 1)
    c5_active.write_message(15, p15)
    inner.write_message(5, c5_active)
    
    # Component 5 (Unknown 2)
    c5_unk = ProtoWriter()
    c5_unk.write_int32(1, 2)
    
    if type_id == 10005009:
         p12 = ProtoWriter()
         p12.write_bytes(2, bytes.fromhex("08ea90d82f"))
         c5_unk.write_message(12, p12)
    else:
         c5_unk.write_message(12, ProtoWriter())
    inner.write_message(5, c5_unk)
    
    inner.write_message(11, ProtoWriter())
    
    decor_def = ProtoWriter()
    decor_def.write_message(1, inner)
    
    return decor_def

def create_resource_entry_stub(guid, name, decoration_payload):
    entry = ProtoWriter()
    
    ident = ProtoWriter()
    ident.write_int32(2, 1)
    ident.write_int32(3, 14)
    ident.write_int64(4, guid)
    entry.write_message(1, ident)
    
    entry.write_string(3, name)
    
    entry.write_int32(5, 28)
    
    entry.write_message(21, decoration_payload)
    
    return entry

def create_reference_locator(guid, kind=14):
    loc = ProtoWriter()
    loc.write_int32(2, 1)
    loc.write_int32(3, kind)
    loc.write_int64(4, guid)
    return loc


def _build_asset_info(guid):
    info = ProtoWriter()
    info.write_int32(2, 1)
    info.write_int32(3, 8)
    info.write_int64(4, guid)
    return info


def _find_varint(fields, tag, default=None):
    for field in fields:
        if field['tag'] == tag and field['wire'] == WireType.VARINT:
            return field['value']
    return default

# ==========================================
# UI Image Node Construction (kind=8, class=15)
# ==========================================

def _build_vector3(x, y, z):
    """Build a Vector3 message: field 1=x, 2=y, 3=z (all float32)"""
    w = ProtoWriter()
    w.write_float(1, x)
    w.write_float(2, y)
    w.write_float(3, z)
    return w

def _build_vector2(x, y):
    """Build a Vector2 message: field 501=x, 502=y (all float32)"""
    w = ProtoWriter()
    w.write_float(501, x)
    w.write_float(502, y)
    return w

def _build_rotation(z_angle):
    """Build a rotation message: field 3=z (float32). Empty if z≈0."""
    if abs(z_angle) < 1e-6:
        return ProtoWriter()  # empty message
    w = ProtoWriter()
    w.write_float(3, z_angle)
    return w

def _build_rect_transform(offset_x, offset_y, size_x, size_y, pivot_x=0.5, pivot_y=0.5, rot_z=0.0):
    """Build a single platform's rect_transform sub-message."""
    w = ProtoWriter()
    w.write_message(501, _build_vector3(1.0, 1.0, 1.0))   # scale
    w.write_message(502, _build_vector2(0.5, 0.5))         # anchor_min
    w.write_message(503, _build_vector2(0.5, 0.5))         # anchor_max
    w.write_message(504, _build_vector2(offset_x, offset_y)) # offset
    w.write_message(505, _build_vector2(size_x, size_y))    # size
    w.write_message(506, _build_vector2(pivot_x, pivot_y))  # pivot
    w.write_message(508, _build_rotation(rot_z))            # rotation
    return w

def _build_platform(platform_type, offset_x, offset_y, size_x, size_y, pivot_x=0.5, pivot_y=0.5, rot_z=0.0):
    """Build a single platform entry: field 501=platform_type(varint), 502=transform(message)."""
    w = ProtoWriter()
    w.write_int32(501, platform_type)
    w.write_message(502, _build_rect_transform(offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    return w

def _build_multi_platform(offset_x, offset_y, size_x, size_y, pivot_x=0.5, pivot_y=0.5, rot_z=0.0):
    """Build the multi_platform message with 4 identical platform entries.
    Platform types: 0=KEYBOARD, 1=TOUCHSCREEN, 2=CONTROLLER_CONSOLE, 3=CONTROLLER_MOBILE
    All 4 platforms get identical transform values.
    """
    w = ProtoWriter()
    # Platform 0 (KEYBOARD) - no platform_type field (defaults to 0 or omitted)
    w.write_message(501, _build_platform(0, offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    # Platform 1 (TOUCHSCREEN)
    w.write_message(501, _build_platform(1, offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    # Platform 2 (CONTROLLER_CONSOLE)
    w.write_message(501, _build_platform(2, offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    # Platform 3 (CONTROLLER_MOBILE)
    w.write_message(501, _build_platform(3, offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    w.write_int32(502, 9)  # field502 = 9 (platform count or type flag)
    w.write_int32(504, 1)  # field504 = 1
    return w

def _build_transform_data(offset_x, offset_y, size_x, size_y, guid, pivot_x=0.5, pivot_y=0.5, rot_z=0.0):
    """Build the outer transform data message (field 505 in ui.content).
    Structure:
      field 11 = builtin transform stub (multi_platform{} empty, type:2)
      field 501 = 1 (type identifier)
      field 502 = 12 (field identifier)
    """
    w = ProtoWriter()
    # field 11: builtin transform (empty multi_platform, type:2)
    builtin = ProtoWriter()
    builtin_empty_mp = ProtoWriter()  # empty multi_platform
    builtin.write_message(12, builtin_empty_mp)
    builtin.write_int32(501, 2)  # type: 2
    w.write_message(11, builtin)

    details = ProtoWriter()
    details_transform = ProtoWriter()
    details_transform.write_message(12, _build_multi_platform(offset_x, offset_y, size_x, size_y, pivot_x, pivot_y, rot_z))
    details_transform.write_int32(501, 2)  # type: 2
    details.write_message(13, details_transform)
    details.write_int32(501, 4)   # field501: 4
    details.write_int32(502, 12)  # field502: 12
    details.write_int32(503, 1)   # field503: 1
    details.write_message(504, _build_asset_info(guid))
    w.write_message(503, details)
    w.write_int32(501, 1)   # field501: 1
    w.write_int32(502, 12)  # field502: 12
    return w

def _build_field14_data(guid):
    """Build the field14 data message (visibility/placeholder data).
    Structure matches image_template_printed.txt:
      field14 { empty15: <empty>, field501: 5 }
      field501: 4
      field502: 23
      details {
        field14 { empty15: <empty>, field501: 5 }
        field501: 5
        field502: 23
        field503: 1
        asset_info { special_type: 1, category: 8, guid: <guid> }
      }
    """
    w = ProtoWriter()
    # field14 inner
    field14_inner = ProtoWriter()
    field14_inner.write_bytes(15, b'')  # empty15
    field14_inner.write_int32(501, 5)
    w.write_message(14, field14_inner)  # field 14 = field14
    w.write_int32(501, 4)
    w.write_int32(502, 23)
    # details
    details = ProtoWriter()
    details_field14 = ProtoWriter()
    details_field14.write_bytes(15, b'')  # empty15
    details_field14.write_int32(501, 5)
    details.write_message(14, details_field14)
    details.write_int32(501, 5)
    details.write_int32(502, 23)
    details.write_int32(503, 1)
    # asset_info in details
    details.write_message(504, _build_asset_info(guid))
    w.write_message(503, details)  # details is field 503
    return w

def _build_image_settings_data(image_asset_ref, packed_color, guid):
    """Build the image_settings data message.
    Structure:
      image_settings_component: <empty>
      field501: 21
      field502: 38
      details {
        image_settings { image_asset_ref, source_meta{sentinel_id}, packed_color, field6:empty, field10:empty }
        field501: 22
        field502: 38
        field503: 1
        asset_info { special_type:1, category:8, guid:<guid> }
      }
    """
    w = ProtoWriter()
    w.write_bytes(31, b'')  # image_settings_component: empty (field 31)
    w.write_int32(501, 21)
    w.write_int32(502, 38)
    # details
    details = ProtoWriter()
    # image_settings (field 31 in details)
    img_settings = ProtoWriter()
    img_settings.write_int32(2, image_asset_ref)  # image_asset_ref
    # source_meta (field 3)
    source_meta = ProtoWriter()
    source_meta.write_int64(501, 18446744073709551615)  # sentinel_id: max uint64
    img_settings.write_message(3, source_meta)
    img_settings.write_int32(4, packed_color)  # packed_color (ARGB int)
    img_settings.write_bytes(6, b'')  # field6: empty
    img_settings.write_bytes(10, b'')  # field10: empty
    details.write_message(31, img_settings)
    details.write_int32(501, 22)
    details.write_int32(502, 38)
    details.write_int32(503, 1)
    # asset_info in details
    details.write_message(504, _build_asset_info(guid))
    w.write_message(503, details)
    return w


def _build_mask_settings_data(position_x, position_y, size_x, size_y, shape_type, enabled, guid):
    """Build the parent mask_settings component using the image template layout."""
    w = ProtoWriter()
    w.write_bytes(46, b'')  # mask_settings_component: <empty>
    w.write_int32(501, 38)
    w.write_int32(502, 56)

    details = ProtoWriter()
    mask_settings = ProtoWriter()
    mask_settings.write_message(1, _build_vector2(position_x, position_y))
    mask_settings.write_message(2, _build_vector2(size_x, size_y))
    mask_settings.write_int32(3, int(shape_type))
    mask_settings.write_bool(4, bool(enabled))
    details.write_message(47, mask_settings)
    details.write_int32(501, 40)
    details.write_int32(502, 56)
    details.write_int32(503, 1)
    details.write_message(504, _build_asset_info(guid))
    w.write_message(503, details)
    return w

def _build_name_data(name=""):
    """Build the name data message.
    Structure: name { } or name { value: "<name>" }, field501: 2, field502: 15
    For empty names, writes an empty sub-message (no value field inside).
    """
    w = ProtoWriter()
    name_inner = ProtoWriter()
    if name:  # Only write value field if name is non-empty
        name_inner.write_string(501, name)
    w.write_message(12, name_inner)  # name wrapper is field 12
    w.write_int32(501, 2)
    w.write_int32(502, 15)
    return w


def _normalize_group_name(name, fallback="素材组"):
    if not isinstance(name, str):
        return fallback
    raw = name.strip()
    if not raw:
        return fallback
    base_name = os.path.basename(raw)
    stem, _ = os.path.splitext(base_name)
    normalized = stem.strip() or base_name.strip()
    return normalized or fallback


def _normalize_element_name(element, fallback):
    if not isinstance(element, dict):
        return fallback
    raw = element.get("name")
    if not isinstance(raw, str):
        return fallback
    normalized = raw.strip()
    return normalized or fallback


def _order_elements_for_image_mode(elements):
    # `scene_to_gia_document()` already serializes elements in editor order:
    # background/bottom first, topmost last. GIA image-mode children are
    # interpreted in the opposite direction, so we reverse the full list here
    # to keep the exported stacking consistent with the editor.
    return list(reversed(list(elements or [])))


def _storage_order_elements_for_image_mode(elements):
    # Keep the resource entry order aligned with the UI child order so layer
    # numbering, generated payload indices, and stored child references all
    # describe the same top-to-bottom stack in GIA image mode.
    return list(reversed(list(elements or [])))

def create_ui_image_payload(guid, index, parent_guid, offset_x, offset_y, size_x, size_y,
                             image_asset_ref=100002, packed_color=0x80FFFFFF, rot_z=0.0,
                             pivot_x=0.5, pivot_y=0.5, name=""):
    """Create a UI image node payload (kind=8, resource_class=15).
    
    This constructs the ui.content message for a dependency node in the image template format.
    
    Args:
        guid: Unique identifier for this node
        index: Sequential index (starts from 2 for first child)
        parent_guid: GUID of the parent (primary resource)
        offset_x, offset_y: Position offset
        size_x, size_y: Size dimensions
        image_asset_ref: Referenced image asset ID (default 100002)
        packed_color: ARGB packed color integer (default 0x80FFFFFF = 50% white)
        rot_z: Rotation angle in degrees (default 0)
        pivot_x, pivot_y: Pivot point (default 0.5, 0.5)
        name: Node name (default empty)
    """
    content = ProtoWriter()
    
    # guid (field 501)
    content.write_int64(501, guid)
    
    # info[0]: guid info (field 502)
    info_guid = ProtoWriter()
    guid_wrapper = ProtoWriter()
    guid_wrapper.write_int64(501, guid)
    info_guid.write_message(11, guid_wrapper)  # guid wrapper is field 11 (guid), NOT field 12 (index)
    info_guid.write_int32(501, 1)
    info_guid.write_int32(502, 5)
    content.write_message(502, info_guid)
    
    # info[1]: index info (field 502)
    info_index = ProtoWriter()
    index_wrapper = ProtoWriter()
    index_wrapper.write_int32(501, index)
    info_index.write_message(12, index_wrapper)  # index wrapper is field 12
    info_index.write_int32(501, 2)
    info_index.write_int32(502, 6)
    content.write_message(502, info_index)
    
    # parent (field 504)
    content.write_int64(504, parent_guid)
    
    # data[0]: name (field 505)
    content.write_message(505, _build_name_data(name))
    
    # data[1]: field14 (field 505)
    content.write_message(505, _build_field14_data(guid))
    
    # data[2]: transform (field 505)
    content.write_message(505, _build_transform_data(offset_x, offset_y, size_x, size_y, guid, pivot_x, pivot_y, rot_z))
    
    # data[3]: image_settings (field 505)
    content.write_message(505, _build_image_settings_data(image_asset_ref, packed_color, guid))
    
    return content

def create_ui_image_entry(guid, name, ui_content_payload):
    """Create a ResourceEntry for a UI image node (kind=8, resource_class=15).
    
    Structure (matching image_template.gia):
      identity { service_domain: 1, kind: 8, asset_guid: <guid> }
      resource_class: 15
      ui { content { ... } }
    
    Note: internal_name (field 3) is NOT written for dependencies,
    matching the template structure.
    """
    entry = ProtoWriter()
    
    # identity (field 1)
    ident = ProtoWriter()
    ident.write_int32(2, 1)    # service_domain: 1
    ident.write_int32(3, 8)    # kind: 8
    ident.write_int64(4, guid)  # asset_guid
    entry.write_message(1, ident)

    # Note: We intentionally do NOT write internal_name (field 3) here
    # because the image_template.gia dependencies don't have this field.
    # The name parameter is used for logging/debugging only.
    
    # resource_class (field 5)
    entry.write_int32(5, 15)
    
    # ui.content (field 19)
    ui = ProtoWriter()
    ui.write_message(1, ui_content_payload)  # content is field 1 in ui
    entry.write_message(19, ui)
    
    return entry

def _parse_gia_root_fields(file_data):
    """Parse GIA file into header, content fields, and tail."""
    header = file_data[:20]
    content_len = int.from_bytes(header[16:20], 'big')
    content = file_data[20:20+content_len]
    tail = file_data[20 + content_len : 24 + content_len]

    reader = ProtoReader(content)
    root_fields = []
    while not reader.eof():
        tag, wire = reader.read_tag()
        if tag is None:
            break
        if wire == WireType.LENGTH_DELIMITED:
            val = reader.read_length_delimited()
            root_fields.append((tag, wire, val))
        elif wire == WireType.VARINT:
            val = reader.read_varint()
            root_fields.append((tag, wire, val))
        elif wire == WireType.FIXED32:
            val = reader.read_fixed32()
            root_fields.append((tag, wire, val))
        elif wire == WireType.FIXED64:
            val = reader.read_fixed64()
            root_fields.append((tag, wire, val))

    return header, content_len, root_fields, tail


def _rebuild_gia(header, content_len, root_fields, tail, new_entries, pr_writer_bytes, removed_class, mode):
    """Rebuild a GIA file from parsed components.
    
    Args:
        header: Original 20-byte header
        content_len: Original content length
        root_fields: Parsed root-level fields (tag, wire, val)
        tail: Original 4-byte tail magic
        new_entries: List of ProtoWriter for new dependency entries
        pr_writer_bytes: Rebuilt primary resource bytes
        removed_class: Resource class to remove from existing dependencies
        mode: MODE_DECORATION or MODE_IMAGE
    """
    final_bundle = ProtoWriter()
    # Write primary resource
    final_bundle.write_tag(1, WireType.LENGTH_DELIMITED)
    final_bundle.write_varint(len(pr_writer_bytes))
    final_bundle.buffer.extend(pr_writer_bytes)

    # Write existing non-removed dependencies
    for tag, wire, val in root_fields:
        if tag == 2:
            if isinstance(val, bytes):
                info = parse_resource_entry(val)
                if info['class'] != removed_class:
                    final_bundle.write_tag(2, WireType.LENGTH_DELIMITED)
                    final_bundle.write_varint(len(val))
                    final_bundle.buffer.extend(val)
        elif tag not in [1, 2]:
            if isinstance(val, bytes):
                final_bundle.write_tag(tag, WireType.LENGTH_DELIMITED)
                final_bundle.write_varint(len(val))
                final_bundle.buffer.extend(val)
            elif isinstance(val, int):
                final_bundle.write_tag(tag, WireType.VARINT)
                final_bundle.write_varint(val)

    # Write new dependency entries
    for entry in new_entries:
        final_bundle.write_message(2, entry)

    new_content = final_bundle.get_bytes()
    new_len = len(new_content)
    new_file_size = 20 + new_len
    new_header = new_file_size.to_bytes(4, 'big') + header[4:16] + new_len.to_bytes(4, 'big')

    return new_header + new_content + tail


def _rebuild_primary_resource_decoration(pr_fields, removed_guids, new_refs, new_decoration_guids):
    """Rebuild primary resource for decoration mode."""
    pr_writer = ProtoWriter()
    inserted_new_refs = False

    for f in pr_fields:
        if f['tag'] == 2:
            ref_guid = check_locator_guid(f['data'])
            if ref_guid in removed_guids:
                if not inserted_new_refs:
                    for ref_writer in new_refs:
                        pr_writer.write_message(2, ref_writer)
                    inserted_new_refs = True
                continue
            pr_writer.write_tag(2, WireType.LENGTH_DELIMITED)
            pr_writer.write_varint(len(f['data']))
            pr_writer.buffer.extend(f['data'])
        else:
            if 'data' in f:
                if f['tag'] == 11:
                    patched_prefab = patch_prefab_guid_list(f['data'], new_decoration_guids)
                    pr_writer.write_tag(11, WireType.LENGTH_DELIMITED)
                    pr_writer.write_varint(len(patched_prefab))
                    pr_writer.buffer.extend(patched_prefab)
                else:
                    pr_writer.write_tag(f['tag'], WireType.LENGTH_DELIMITED)
                    pr_writer.write_varint(len(f['data']))
                    pr_writer.buffer.extend(f['data'])
            elif 'value' in f:
                pr_writer.write_tag(f['tag'], WireType.VARINT)
                pr_writer.write_varint(f['value'])
            elif 'raw' in f:
                pr_writer.write_tag(f['tag'], f['wire'])
                pr_writer.buffer.extend(f['raw'])

    if not inserted_new_refs:
        for ref_writer in new_refs:
            pr_writer.write_message(2, ref_writer)

    return pr_writer.get_bytes()


def _normalize_mask_shape_type(shape_type):
    if isinstance(shape_type, str):
        lowered = shape_type.strip().lower()
        if lowered in ('rect', 'rectangle'):
            return 1
        if lowered in ('circle', 'ellipse'):
            return 2
    try:
        return int(shape_type)
    except Exception:
        return 1


def _normalize_element_shape_type(shape_type):
    if not isinstance(shape_type, str):
        return shape_type

    lowered = shape_type.strip().lower()
    aliases = {
        'rect': 'rectangle',
        'rectangle': 'rectangle',
        'circle': 'ellipse',
        'ellipse': 'ellipse',
        'triangle': 'triangle',
        'tri': 'triangle',
        'four_point_star': 'four_point_star',
        'four-point-star': 'four_point_star',
        'four point star': 'four_point_star',
        '4_point_star': 'four_point_star',
        '4-point-star': 'four_point_star',
        '4 point star': 'four_point_star',
        '4star': 'four_point_star',
        'star4': 'four_point_star',
        '四角星': 'four_point_star',
        'five_point_star': 'five_point_star',
        'five-point-star': 'five_point_star',
        'five point star': 'five_point_star',
        '5_point_star': 'five_point_star',
        '5-point-star': 'five_point_star',
        '5 point star': 'five_point_star',
        '5star': 'five_point_star',
        'star5': 'five_point_star',
        '五角星': 'five_point_star',
    }
    return aliases.get(lowered, lowered)


def _normalize_mask_settings(mask_settings):
    if not mask_settings:
        return None
    center = mask_settings.get('position') or mask_settings.get('center') or {}
    size = mask_settings.get('size') or {}
    size_x = size.get('x', size.get('width', 0))
    size_y = size.get('y', size.get('height', 0))
    return {
        'position_x': float(center.get('x', 0.0)),
        'position_y': float(center.get('y', 0.0)),
        'size_x': float(size_x),
        'size_y': float(size_y),
        'shape_type': _normalize_mask_shape_type(mask_settings.get('shape_type', 1)),
        'enabled': bool(mask_settings.get('enabled', True)),
    }


def _color_to_packed(color, alpha, fallback):
    if isinstance(color, int):
        return color & 0xFFFFFFFF

    alpha_value = alpha
    if alpha_value is None:
        alpha_int = (fallback >> 24) & 0xFF
    elif isinstance(alpha_value, float) and 0.0 <= alpha_value <= 1.0:
        alpha_int = int(max(0, min(255, round(alpha_value * 255.0))))
    else:
        alpha_int = int(max(0, min(255, round(float(alpha_value)))))

    if isinstance(color, str):
        value = color.strip().lstrip('#')
        if len(value) == 3:
            value = ''.join(ch * 2 for ch in value)
        if len(value) == 6:
            rgb = int(value, 16)
            return ((alpha_int << 24) | rgb) & 0xFFFFFFFF
        return fallback

    if isinstance(color, (list, tuple)) and len(color) >= 3:
        red = int(max(0, min(255, round(float(color[0])))))
        green = int(max(0, min(255, round(float(color[1])))))
        blue = int(max(0, min(255, round(float(color[2])))))
        if len(color) >= 4:
            alpha_component = color[3]
            if isinstance(alpha_component, float) and 0.0 <= alpha_component <= 1.0:
                alpha_int = int(max(0, min(255, round(alpha_component * 255.0))))
            else:
                alpha_int = int(max(0, min(255, round(float(alpha_component)))))
        return ((alpha_int << 24) | (red << 16) | (green << 8) | blue) & 0xFFFFFFFF

    return fallback


def _patch_ui_content_children(ui_content_data, new_child_guids, parent_guid, mask_settings=None, group_name=None):
    """Patch the ui.content to replace children list with new GUIDs.
    
    Parses the ui.content message, replaces all field 503 (children) entries
    with the new list, and preserves all other fields.
    """
    fields = parse_message_fields(ui_content_data)
    new_fields = []
    children_written = False
    mask_written = False
    name_written = False
    
    for f in fields:
        if f['tag'] == 503 and f['wire'] == WireType.VARINT:
            # Skip old children entries, write new ones at first occurrence
            if not children_written:
                for guid in new_child_guids:
                    new_fields.append({'tag': 503, 'wire': WireType.VARINT, 'value': guid})
                children_written = True
            continue
        elif f['tag'] == 505 and f['wire'] == WireType.LENGTH_DELIMITED:
            data_fields = parse_message_fields(f['data'])
            field502 = _find_varint(data_fields, 502)
            if mask_settings is not None and field502 == 56:
                new_fields.append({
                    'tag': 505,
                    'wire': WireType.LENGTH_DELIMITED,
                    'data': _build_mask_settings_data(
                        mask_settings['position_x'],
                        mask_settings['position_y'],
                        mask_settings['size_x'],
                        mask_settings['size_y'],
                        mask_settings['shape_type'],
                        mask_settings['enabled'],
                        parent_guid,
                    ).get_bytes(),
                })
                mask_written = True
                continue
            if group_name and field502 == 15:
                new_fields.append({
                    'tag': 505,
                    'wire': WireType.LENGTH_DELIMITED,
                    'data': _build_name_data(group_name).get_bytes(),
                })
                name_written = True
                continue
            new_fields.append(f)
            continue
        else:
            new_fields.append(f)
    
    # If no children field existed, add them
    if not children_written:
        for guid in new_child_guids:
            new_fields.append({'tag': 503, 'wire': WireType.VARINT, 'value': guid})

    if mask_settings is not None and not mask_written:
        new_fields.append({
            'tag': 505,
            'wire': WireType.LENGTH_DELIMITED,
            'data': _build_mask_settings_data(
                mask_settings['position_x'],
                mask_settings['position_y'],
                mask_settings['size_x'],
                mask_settings['size_y'],
                mask_settings['shape_type'],
                mask_settings['enabled'],
                parent_guid,
            ).get_bytes(),
        })

    if group_name and not name_written:
        new_fields.append({
            'tag': 505,
            'wire': WireType.LENGTH_DELIMITED,
            'data': _build_name_data(group_name).get_bytes(),
        })
    
    return build_message(new_fields)


def _patch_primary_resource_image(pr_fields, removed_guids, new_refs, new_child_guids, parent_guid, mask_settings=None, group_name=None):
    """Rebuild primary resource for image mode.
    
    In image mode we need to:
    1. Replace reference_list entries (tag 2) with new ones
    2. Patch the ui.content children list (field 503 inside field 19 -> field 1)
    3. Preserve everything else (especially mask_settings, transform, etc.)
    """
    pr_writer = ProtoWriter()
    inserted_new_refs = False
    resource_name_written = False
    
    for f in pr_fields:
        if f['tag'] == 2:
            # reference_list - replace removed ones with new
            ref_guid = check_locator_guid(f['data'])
            if ref_guid in removed_guids:
                if not inserted_new_refs:
                    for ref_writer in new_refs:
                        pr_writer.write_message(2, ref_writer)
                    inserted_new_refs = True
                continue
            # Keep non-removed references
            pr_writer.write_tag(2, WireType.LENGTH_DELIMITED)
            pr_writer.write_varint(len(f['data']))
            pr_writer.buffer.extend(f['data'])
        elif f['tag'] == 19:
            # ui (field 19) - need to patch ui.content children
            ui_fields = parse_message_fields(f['data'])
            new_ui_fields = []
            for uf in ui_fields:
                if uf['tag'] == 1 and uf['wire'] == WireType.LENGTH_DELIMITED:
                    # content (field 1 inside ui) - patch children
                    patched_content = _patch_ui_content_children(
                        uf['data'],
                        new_child_guids,
                        parent_guid,
                        mask_settings,
                        group_name,
                    )
                    new_ui_fields.append({'tag': 1, 'wire': WireType.LENGTH_DELIMITED, 'data': patched_content})
                else:
                    new_ui_fields.append(uf)
            patched_ui = build_message(new_ui_fields)
            pr_writer.write_tag(19, WireType.LENGTH_DELIMITED)
            pr_writer.write_varint(len(patched_ui))
            pr_writer.buffer.extend(patched_ui)
        elif f['tag'] == 3 and f['wire'] == WireType.LENGTH_DELIMITED and group_name:
            pr_writer.write_tag(3, WireType.LENGTH_DELIMITED)
            encoded = group_name.encode('utf-8')
            pr_writer.write_varint(len(encoded))
            pr_writer.buffer.extend(encoded)
            resource_name_written = True
        else:
            if 'data' in f:
                pr_writer.write_tag(f['tag'], WireType.LENGTH_DELIMITED)
                pr_writer.write_varint(len(f['data']))
                pr_writer.buffer.extend(f['data'])
            elif 'value' in f:
                pr_writer.write_tag(f['tag'], WireType.VARINT)
                pr_writer.write_varint(f['value'])
            elif 'raw' in f:
                pr_writer.write_tag(f['tag'], f['wire'])
                pr_writer.buffer.extend(f['raw'])
    
    if not inserted_new_refs:
        for ref_writer in new_refs:
            pr_writer.write_message(2, ref_writer)

    if group_name and not resource_name_written:
        pr_writer.write_string(3, group_name)
    
    return pr_writer.get_bytes()


def convert_json_to_gia_bytes(json_data, base_gia_path, verbose=False, mode=MODE_DECORATION):
    """Convert JSON shape data to GIA binary bytes.
    
    Args:
        json_data: Dictionary with shape elements
        base_gia_path: Path to template GIA file
        verbose: Whether to print progress info
        mode: MODE_DECORATION (kind=14, class=28) or MODE_IMAGE (kind=8, class=15)
    """
    with open(base_gia_path, 'rb') as f:
        file_data = f.read()

    header, content_len, root_fields, tail = _parse_gia_root_fields(file_data)

    if mode == MODE_IMAGE:
        return _convert_image_mode(json_data, header, content_len, root_fields, tail, verbose)
    else:
        return _convert_decoration_mode(json_data, header, content_len, root_fields, tail, verbose)


def _convert_decoration_mode(json_data, header, content_len, root_fields, tail, verbose):
    """Decoration mode: kind=14, class=28 (legacy decoration nodes)."""
    # Find and remove class=28 dependency nodes
    removed_guids = set()
    for tag, wire, val in root_fields:
        if tag == 2 and isinstance(val, bytes):
            info = parse_resource_entry(val)
            if info['class'] == 28:
                if verbose:
                    print(f"Removing decoration: {info['name']} ({info['guid']})")
                removed_guids.add(info['guid'])

    # Find parent_guid from primary resource
    parent_guid = 0
    pr_data = None
    for tag, wire, val in root_fields:
        if tag == 1 and isinstance(val, bytes):
            pr_data = val
            break
    pr_fields = parse_primary_resource(pr_data)
    for f in pr_fields:
        if f['tag'] == 1:
            parent_guid = check_locator_guid(f['data'])
            break

    # Collect existing GUIDs to avoid collisions
    existing_guids = set()
    for tag, wire, val in root_fields:
        if tag == 1 and isinstance(val, bytes):
            existing_guids.add(check_locator_guid(val))
        elif tag == 2 and isinstance(val, bytes):
            info = parse_resource_entry(val)
            if info['guid']:
                existing_guids.add(info['guid'])
    reserved_guids = set(existing_guids) - set(removed_guids)
    next_guid = 1073749460

    # Generate decoration entries
    new_decor_entries = []
    new_refs = []
    new_decoration_guids = []

    base_circle_x, base_circle_y = 1.0, 1.0
    base_rect_x, base_rect_y = 0.5, 10.0

    badge_type_ids = {20001281, 20001282, 20001283, 20001284, 20001285, 20001286, 20001287}
    ordered_elements = list(reversed(list(json_data.get('elements', []))))

    for i, element in enumerate(ordered_elements):
        shape_type = _normalize_element_shape_type(element.get('type'))
        center = element.get('relative') or element.get('center') or {}
        size = element.get('size') or {}
        rot = element.get('rotation') or {}
        rot_z = rot.get('z', 0.0) if isinstance(rot, dict) else rot

        element_type_id = element.get('type_id', 0)
        rot_z_add = element.get('rot_z', 0.0)
        rot_y_add = element.get('rot_y_add', 0.0)

        while next_guid in reserved_guids:
            next_guid += 1
        new_guid = next_guid
        reserved_guids.add(new_guid)
        next_guid += 1

        name = _normalize_element_name(element, str(i + 1))
        type_id = 0
        sx, sy = 1.0, 1.0
        final_rot_z = rot_z
        final_rot_y = 0.0

        if shape_type == 'ellipse':
            type_id = element_type_id if element_type_id else 10005009
            rx = float(size.get('rx', 1.0))
            ry = float(size.get('ry', 1.0))
            sx = (rx * 2.0) / base_circle_x
            sy = (ry * 2.0) / base_circle_y

            if type_id in badge_type_ids:
                final_rot_z = rot_z + rot_z_add
                final_rot_y = rot_y_add
                base_badge_x, base_badge_y = 0.3, 0.3
                sx = (rx * 2.0) / base_badge_x
                sy = (ry * 2.0) / base_badge_y
        elif shape_type in ('rectangle', 'triangle', 'four_point_star', 'five_point_star'):
            type_id = element_type_id if element_type_id else 20002129
            w = float(size.get('width', 1.0))
            h = float(size.get('height', 1.0))
            sx = w / base_rect_x
            sy = h / base_rect_y

        sx = max(0.0, min(float(sx), 50.0))
        sy = max(0.0, min(float(sy), 50.0))
        pos = {'x': float(center.get('x', 0)), 'y': float(center.get('y', 0))}
        scale = {'x': sx, 'y': sy}

        payload = create_decoration_payload(new_guid, name, type_id, parent_guid, pos, scale, rot_z=final_rot_z, rot_y=final_rot_y)
        entry = create_resource_entry_stub(new_guid, name, payload)

        new_decor_entries.append(entry)
        new_decoration_guids.append(new_guid)
        new_refs.append(create_reference_locator(new_guid, kind=14))

        if verbose:
            print(f"Generated {name}")

    pr_bytes = _rebuild_primary_resource_decoration(pr_fields, removed_guids, new_refs, new_decoration_guids)
    return _rebuild_gia(header, content_len, root_fields, tail, new_decor_entries, pr_bytes, removed_class=28, mode=MODE_DECORATION)

def _convert_image_mode(json_data, header, content_len, root_fields, tail, verbose):
    """Image mode: kind=8, class=15 (UI image nodes)."""
    group_name = _normalize_group_name(json_data.get('group_name', ''))

    removed_guids = set()
    for tag, wire, val in root_fields:
        if tag == 2 and isinstance(val, bytes):
            info = parse_resource_entry(val)
            if info['class'] == 15:
                if verbose:
                    print(f"Removing image node: {info['name']} ({info['guid']})")
                removed_guids.add(info['guid'])

    parent_guid = 0
    pr_data = None
    for tag, wire, val in root_fields:
        if tag == 1 and isinstance(val, bytes):
            pr_data = val
            break
    pr_fields = parse_primary_resource(pr_data)
    for f in pr_fields:
        if f['tag'] == 1:
            parent_guid = check_locator_guid(f['data'])
            break

    if verbose:
        print(f"Parent GUID: {parent_guid}")

    existing_guids = set()
    for tag, wire, val in root_fields:
        if tag == 1 and isinstance(val, bytes):
            existing_guids.add(check_locator_guid(val))
        elif tag == 2 and isinstance(val, bytes):
            info = parse_resource_entry(val)
            if info['guid']:
                existing_guids.add(info['guid'])
    reserved_guids = set(existing_guids) - set(removed_guids)
    next_guid = max(removed_guids) + 1 if removed_guids else 1073749460
    while next_guid in reserved_guids:
        next_guid += 1

    new_image_entries = []
    new_refs = []
    new_child_guids = []

    default_packed_color = 0x80FFFFFF
    mask_settings = _normalize_mask_settings(json_data.get('mask'))

    ordered_elements = _order_elements_for_image_mode(json_data.get('elements', []))
    serialized_elements = _storage_order_elements_for_image_mode(json_data.get('elements', []))
    indexed_items = []

    for i, element in enumerate(ordered_elements):
        shape_type = _normalize_element_shape_type(element.get('type'))
        center = element.get('relative') or element.get('center') or {}
        size = element.get('size') or {}
        rot = element.get('rotation') or {}
        rot_z = rot.get('z', 0.0) if isinstance(rot, dict) else rot

        while next_guid in reserved_guids:
            next_guid += 1
        new_guid = next_guid
        reserved_guids.add(new_guid)
        next_guid += 1

        name = _normalize_element_name(element, str(i + 1))
        offset_x = float(center.get('x', 0))
        offset_y = float(center.get('y', 0))

        if shape_type == 'ellipse':
            rx = float(size.get('rx', 1.0))
            ry = float(size.get('ry', 1.0))
            size_x = rx * 2.0
            size_y = ry * 2.0
        elif shape_type in ('rectangle', 'triangle', 'four_point_star', 'five_point_star'):
            size_x = float(size.get('width', 1.0))
            size_y = float(size.get('height', 1.0))
        else:
            size_x = float(size.get('width', 1.0))
            size_y = float(size.get('height', 1.0))

        image_asset_ref = int(element.get('image_asset_ref', DEFAULT_IMAGE_ASSET_REFS.get(shape_type, 100002)))
        packed_color = int(element.get('packed_color', default_packed_color))
        packed_color = _color_to_packed(element.get('color'), element.get('alpha'), packed_color)
        index = i + 2

        ui_content = create_ui_image_payload(
            guid=new_guid,
            index=index,
            parent_guid=parent_guid,
            offset_x=offset_x,
            offset_y=offset_y,
            size_x=size_x,
            size_y=size_y,
            image_asset_ref=image_asset_ref,
            packed_color=packed_color,
            rot_z=rot_z,
            pivot_x=0.5,
            pivot_y=0.5,
            name=name,
        )

        indexed_items.append({
            'serialized_key': id(element),
            'guid': new_guid,
            'name': name,
            'entry': create_ui_image_entry(new_guid, name, ui_content),
            'ref': create_reference_locator(new_guid, kind=8),
        })

        if verbose:
            print(f"Generated image node: {name} (guid={new_guid}, offset=({offset_x}, {offset_y}), size=({size_x}, {size_y}), rot_z={rot_z})")

    entry_map = {item['serialized_key']: item for item in indexed_items}
    for element in serialized_elements:
        item = entry_map.get(id(element))
        if item is None:
            continue
        new_image_entries.append(item['entry'])
        new_child_guids.append(item['guid'])
        new_refs.append(item['ref'])

    pr_bytes = _patch_primary_resource_image(
        pr_fields,
        removed_guids,
        new_refs,
        new_child_guids,
        parent_guid,
        mask_settings,
        group_name,
    )
    return _rebuild_gia(header, content_len, root_fields, tail, new_image_entries, pr_bytes, removed_class=15, mode=MODE_IMAGE)

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Convert JSON shape data to GIA binary format')
    parser.add_argument('--mode', choices=['decoration', 'image'], default='decoration',
                        help='Output mode: decoration (kind=14/class=28) or image (kind=8/class=15)')
    parser.add_argument('--input', default='demo/demo.json', help='Input JSON file path')
    parser.add_argument('--template', default=None, help='Template GIA file path (auto-selected by mode if not specified)')
    parser.add_argument('--output', default=None, help='Output GIA file path (auto-selected by mode if not specified)')
    args = parser.parse_args()

    mode = MODE_IMAGE if args.mode == 'image' else MODE_DECORATION

    # Auto-select template and output paths based on mode
    if args.template is None:
        args.template = 'gia/image_template.gia' if mode == MODE_IMAGE else 'gia/template.gia'
    if args.output is None:
        args.output = 'gia/output_image.gia' if mode == MODE_IMAGE else 'gia/output_simple.gia'

    print(f"Mode: {args.mode}")
    print(f"Loading JSON from {args.input}...")
    with open(args.input, 'r', encoding='utf-8') as f:
        json_data = json.load(f)

    print(f"Loading template GIA from {args.template}...")
    gia_bytes = convert_json_to_gia_bytes(json_data=json_data, base_gia_path=args.template, verbose=True, mode=mode)

    print(f"Writing to {args.output}...")
    with open(args.output, 'wb') as f:
        f.write(gia_bytes)
    print("Done.")

if __name__ == '__main__':
    main()
