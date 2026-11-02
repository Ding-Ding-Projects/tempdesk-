"""NT ACL get/set on SYSVOL paths through the smbd VFS layer, the same way
"samba-tool ntacl get/set --service=sysvol" does it. Requires
python3-samba; imported lazily by the Samba backend and provisioning."""

from __future__ import annotations

import os

from . import sddl as sddlmod


class NtAcl:
    def __init__(self, lp, domain_sid: str):
        from samba import ntacls
        from samba.dcerpc import security
        from samba.samba3 import param as s3param
        try:
            from samba.auth_util import system_session_unix
        except ImportError:  # older Samba
            from samba.auth import system_session as system_session_unix
        # smbd's VFS reads the s3 loadparm context, which must be loaded or
        # every call fails with "unknown service".
        from samba.samba3 import passdb
        s3 = s3param.get_context()
        s3.load(lp.configfile)
        # Same passdb setup as "samba-tool ntacl sysvolreset", so owners that
        # are groups (Domain Admins) can be set without a real chown.
        self._pdb = None
        try:
            s3.set("passdb backend", "samba_dsdb:%s" % lp.samdb_url())
            passdb.reload_static_pdb()
            self._pdb = passdb.PDB(s3.get("passdb backend"))
        except Exception:  # noqa: BLE001
            self._pdb = None
        self._ntacls = ntacls
        self._session = system_session_unix
        self.lp = lp
        self.domain_sid = str(domain_sid)
        self._dsid = security.dom_sid(self.domain_sid)

    def get(self, path: str) -> str:
        sd = self._ntacls.getntacl(self.lp, path, self._session(), direct_db_access=False, service="sysvol")
        return sd.as_sddl(self._dsid)

    def set(self, path: str, sddl_text: str) -> None:
        self._ntacls.setntacl(self.lp, path, sddl_text, self.domain_sid, self._session(),
                              use_ntvfs=False, skip_invalid_chown=self._pdb is not None,
                              passdb=self._pdb, service="sysvol")

    def inherit(self, path: str) -> None:
        """Give path the ACL it inherits from its parent folder."""
        self.set(path, sddlmod.inherit_sddl(self.get(os.path.dirname(path)), os.path.isdir(path)))

    def dsacl_to_fs(self, ds_sddl: str) -> str:
        return self._ntacls.dsacl2fsacl(ds_sddl, self._dsid)
