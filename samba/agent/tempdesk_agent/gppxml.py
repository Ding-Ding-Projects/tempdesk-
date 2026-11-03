"""Group Policy Preferences (GPP) per-area XML read/write.

The exact outer and inner element names and CLSIDs are those Windows uses,
from [MS-GPPREF] 2.2.1.1.2. Each preference item is exposed as a flat dict so
the generic node CRUD can list, add, patch and delete items while the XML on
disk keeps its documented shape: an item has elementType, id (uid), name,
status, disabled, the Properties attributes under "properties", and the raw
item-level-targeting XML under "filters".
"""

from __future__ import annotations

import datetime as dt
import os
import uuid
import xml.etree.ElementTree as ET


class Area:
    def __init__(self, name, outer, outer_clsid, inner, inner_clsid, computer, user, variants=None):
        self.name = name
        self.outer = outer
        self.outer_clsid = outer_clsid
        self.inner = inner
        self.inner_clsid = inner_clsid
        self.computer = computer
        self.user = user
        self.variants = {inner: inner_clsid}
        if variants:
            self.variants.update(variants)


# [MS-GPPREF] 2.2.1.1.2 outer/inner element names and CLSIDs.
AREAS: dict[str, Area] = {}


def _a(*args, **kw):
    a = Area(*args, **kw)
    AREAS[a.name] = a
    return a


_a("Applications", "Applications", "{16DB8EC4-EBFC-4958-98EE-712E9DD3A966}", "Application", "{C8535E2E-148D-494d-8E9A-71FC46649B5E}", True, True)
_a("Drives", "Drives", "{8FDDCC1A-0C3C-43cd-A6B4-71A6DF20DA8C}", "Drive", "{935D1B74-9CB8-4e3c-9914-7DD559B7A417}", False, True)
_a("EnvironmentVariables", "EnvironmentVariables", "{BF141A63-327B-438a-B9BF-2C188F13B7AD}", "EnvironmentVariable", "{78570023-8373-4a19-BA80-2F150738EA19}", True, True)
_a("Files", "Files", "{215B2E53-57CE-475c-80FE-9EEC14635851}", "File", "{50BE44C8-567A-4ed1-B1D0-9234FE1F38AF}", True, True)
_a("Folders", "Folders", "{77CC39E7-3D16-4f8f-AF86-EC0BBEE2C861}", "Folder", "{07DA02F5-F9CD-4397-A550-4AE21B6B4BD3}", True, True)
_a("IniFiles", "IniFiles", "{694C651A-08F2-47fa-A427-34C4F62BA207}", "Ini", "{EEFACE84-D3D8-4680-8D4B-BF103E759448}", True, True)
_a("NetworkShares", "NetworkShareSettings", "{520870D8-A6E7-47e8-A8D8-E6A4E76EAEC2}", "NetShare", "{2888C5E7-94FC-4739-90AA-2C1536D68BC0}", True, False)
_a("Registry", "RegistrySettings", "{A3CCFC41-DFDB-43a5-8D26-0FE8B954DA51}", "Registry", "{9CD4B2F4-923D-47f5-A062-E897DD1DAD50}", True, True,
   {"Collection": "{53B533F5-224C-47e3-B01B-CA3B3F3FF4BF}"})
_a("Shortcuts", "Shortcuts", "{872ECB34-B2EC-401b-A585-D32574AA90EE}", "Shortcut", "{4F2F7C55-2790-433e-8127-0739D1CFA327}", True, True)
_a("DataSources", "DataSources", "{380F820F-F21B-41ac-A3CC-24D4F80F067B}", "DataSource", "{5C209626-D820-4d69-8D50-1FACD6214488}", True, True)
_a("Devices", "Devices", "{4DD26924-3F32-47aa-BF33-36D51BD1E54E}", "Device", "{2E1C95D0-85FB-403a-A57C-A508854FB7C8}", True, True)
_a("NetworkOptions", "NetworkOptions", "{09686AD1-5D80-48ee-A940-690A6DF02A90}", "VPN", "{0532F359-3205-4d32-ADB7-9AEC6402BECF}", True, True,
   {"DUN": "{9B0D030D-9396-49c1-8DEF-08B35B5BB79E}"})
_a("Printers", "Printers", "{1F577D12-3D1B-471e-A1B7-060317597B9C}", "SharedPrinter", "{9A5E9697-9095-436d-A0EE-4D128FDFBCE5}", True, True,
   {"PortPrinter": "{C3A739D2-4A44-401e-9F9D-88E5E77DFB3E}", "LocalPrinter": "{F08996D5-568B-45f5-BB7A-D3FB1E370B0A}"})
_a("ScheduledTasks", "ScheduledTasks", "{CC63F200-7309-4ba0-B154-A71CD118DBCC}", "Task", "{2DEECB1C-261F-4e13-9B21-16FB83BC03BD}", True, True,
   {"ImmediateTask": "{9F030D12-DDA3-4C26-8548-B7CE9151166A}", "TaskV2": "{D8896631-B747-47a7-84A6-C155337F3BC8}",
    "ImmediateTaskV2": "{9756B581-76EC-4169-9AFC-0CA8D43ADB5F}"})
_a("Services", "NTServices", "{2CFB484A-4E96-4b5d-A0B6-093D2F91E6AE}", "NTService", "{AB6F0B67-341F-4e51-92F9-005FBFBA1A43}", True, False)
_a("FolderOptions", "FolderOptions", "{8AB5F5D7-F676-48ab-A94E-1186E120EFDC}", "GlobalFolderOptionsVista", "{DBF1E3CD-4CA2-407c-BE84-5F67D3BE754D}", True, True,
   {"GlobalFolderOptions": "{E7632293-E3FC-4fee-9CD3-584C95D8D2A0}", "OpenWith": "{100B9C09-906A-4f5a-9C41-1BD98B6CA022}",
    "FileType": "{580C4D3B-7A89-44d0-92D2-C105702C7BD0}"})
_a("InternetSettings", "InternetSettings", "{B611EB48-F531-42cd-A1F6-5E0D015377BA}", "Internet", "{8C0FE68F-E8A2-4f17-99E7-C6EFED208917}", False, True,
   {"IE7": "{683F7AD7-E782-4232-8A6D-F22431F12DB5}"})
_a("LocalUsersAndGroups", "Groups", "{3125E937-EB16-4b4c-9934-544FC6D24D26}", "Group", "{6D4A79E4-529C-4481-ABD0-F5BD7EA93BA7}", True, True,
   {"User": "{DF5F1855-51E5-4d24-8B1A-D9BDE98BA1D1}"})
_a("PowerOptions", "PowerOptions", "{7B0F9381-C3B8-4525-8167-87349B671D94}", "GlobalPowerOptionsV2", "{2B130A62-fc14-4572-91C3-5435C6A0C3FC}", True, True,
   {"GlobalPowerOptions": "{46D0DCC4-FC14-48fb-829B-854868C7DC16}", "PowerScheme": "{DE828AFA-7E71-480e-8081-5447CBE87754}"})
_a("RegionalOptions", "Regional", "{BDBA23C2-DE02-434e-8D89-13E53CB6710B}", "RegionalOptions", "{C126A328-BECF-4acc-BA8D-C9C7F6B84E49}", False, True)
_a("StartMenu", "StartMenuTaskbar", "{4C4059E4-2F6E-4630-9CB8-5D9A89252C3B}", "StartMenuVista", "{8B03851A-1210-4621-80B6-C334A4F1C941}", False, True,
   {"StartMenu": "{F722CC65-E38A-496b-BA76-49EBF9571415}"})


def get(name: str) -> Area | None:
    return AREAS.get(name)


def _tag(el) -> str:
    return el.tag.split("}")[-1]


def read_items(path: str) -> list[dict]:
    items = []
    if not os.path.exists(path):
        return items
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return items
    for el in list(root):
        items.append(_shape(el))
    return items


def _shape(el) -> dict:
    item = {
        "elementType": _tag(el),
        "id": el.get("uid"),
        "name": el.get("name"),
        "status": el.get("status"),
        "disabled": el.get("disabled") == "1",
        "changed": el.get("changed"),
        "userContext": el.get("userContext") == "1",
        "removePolicy": el.get("removePolicy") == "1",
        "bypassErrors": el.get("bypassErrors") == "1",
    }
    props = {}
    filters = None
    for child in el:
        if _tag(child) == "Properties":
            props = dict(child.attrib)
        elif _tag(child) == "Filters":
            filters = ET.tostring(child, encoding="unicode")
    item["properties"] = props
    item["filters"] = filters
    return item


def write_items(path: str, area: Area, items: list[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    root = ET.Element(area.outer, {"clsid": area.outer_clsid})
    for item in items:
        root.append(_build(area, item))
    tree = ET.ElementTree(root)
    tmp = path + ".tdtmp"
    tree.write(tmp, encoding="utf-8", xml_declaration=True)
    os.replace(tmp, path)


def _build(area: Area, item: dict):
    element_type = item.get("elementType") or area.inner
    clsid = area.variants.get(element_type)
    if clsid is None:
        element_type, clsid = area.inner, area.inner_clsid
    el = ET.Element(element_type, {"clsid": clsid})
    if item.get("name"):
        el.set("name", str(item["name"]))
    if item.get("status"):
        el.set("status", str(item["status"]))
    uid = item.get("id") or ("{" + str(uuid.uuid4()).upper() + "}")
    el.set("uid", uid)
    el.set("changed", dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))
    for attr, key in (("disabled", "disabled"), ("userContext", "userContext"),
                      ("removePolicy", "removePolicy"), ("bypassErrors", "bypassErrors")):
        if item.get(key):
            el.set(attr, "1")
    el.set("image", "0")
    filters = item.get("filters")
    if filters:
        try:
            el.append(ET.fromstring(filters))
        except ET.ParseError as e:
            raise ValueError(f"the 'filters' field is not valid XML: {e}")
    props = item.get("properties") or {}
    pe = ET.SubElement(el, "Properties")
    for k, v in props.items():
        pe.set(k, "" if v is None else str(v))
    return el
