"""Read owner-provisioned setup and prepare the two portal environments."""

import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit


STATE = Path("/var/lib/tempdesk")
RUNTIME = Path("/run/tempdesk-appliance")
SETUP = "deployment.json"
LAN_RANGES = tuple(ipaddress.ip_network(value) for value in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
))
KEYS = {
    "lanAddress", "sourceNetwork", "agentUrl", "agentCertificateSha256",
    "guestKey", "managementKey", "sessionSecret",
}


def owner_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > 32768:
            raise ValueError("Unsafe configuration file")
        data = handle.read(32769)
        if len(data) > 32768:
            raise ValueError("Configuration size limit")
        return json.loads(data)


def owner_directory(path):
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError("Unsafe configuration directory")


def validate(data):
    if not isinstance(data, dict) or data.keys() != KEYS:
        raise ValueError("Configuration fields do not match")
    if any(not isinstance(v, str) or not 0 < len(v) <= 2048 or not v.isascii()
           or not v.isprintable() or v.strip() != v for v in data.values()):
        raise ValueError("Invalid settings text")
    address = ipaddress.IPv4Address(data["lanAddress"])
    network = ipaddress.IPv4Network(data["sourceNetwork"])
    if not any(network.subnet_of(private) for private in LAN_RANGES) or address not in network:
        raise ValueError("LAN settings must be private")
    if network.prefixlen < 8 or address in {network.network_address, network.broadcast_address}:
        raise ValueError("Select a host on the LAN")
    origin = urlsplit(data["agentUrl"])
    if (origin.scheme != "https" or not origin.hostname or origin.username is not None
            or origin.password is not None or origin.query or origin.fragment
            or origin.port == 0 or origin.path not in ("", "/", "/api/v1", "/api/v1/")):
        raise ValueError("Use a pinned HTTPS agent endpoint")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", data["agentCertificateSha256"]):
        raise ValueError("Invalid agent TLS pin")
    if (min(len(data["guestKey"]), len(data["managementKey"])) < 24
            or len(data["sessionSecret"]) < 32 or data["guestKey"] == data["managementKey"]):
        raise ValueError("Supply distinct guest and management credentials")


def write_private(path, data):
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="ascii", newline="\n") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        tmp.unlink(missing_ok=True)


def configure():
    if not os.path.ismount(STATE):
        raise ValueError("The persistent state partition is not mounted")
    settings = STATE / "config"
    owner_directory(settings)
    owner_directory(RUNTIME)
    path = settings / SETUP
    try:
        data = owner_file(path)
    except FileNotFoundError:
        seed = RUNTIME / "seed"
        if not os.path.ismount(seed):
            return 3
        try:
            data = owner_file(seed / SETUP)
        except FileNotFoundError:
            return 3
        validate(data)
        write_private(path, json.dumps(data))
    validate(data)
    address = data["lanAddress"]
    addresses = json.loads(subprocess.check_output(
        ["ip", "-j", "-4", "address", "show", "scope", "global"], text=True,
    ))
    if not any(info.get("local") == address
               for interface in addresses for info in interface.get("addr_info", ())):
        return 4
    connection = (
        f"AGENT_URL={data['agentUrl']}\n"
        f"AGENT_CERT_SHA256={data['agentCertificateSha256']}\n"
    )
    write_private(RUNTIME / "guest.env", connection + f"AGENT_KEY={data['guestKey']}\n")
    write_private(RUNTIME / "management.env", connection +
                  f"AGENT_KEY={data['managementKey']}\nSESSION_SECRET={data['sessionSecret']}\n")
    write_private(RUNTIME / "network", address + "\n" + data["sourceNetwork"] + "\n")
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(configure())
    except (OSError, subprocess.SubprocessError, TypeError, ValueError):
        print("TempDesk appliance rejected the protected deployment configuration.", file=sys.stderr)
        sys.exit(1)
