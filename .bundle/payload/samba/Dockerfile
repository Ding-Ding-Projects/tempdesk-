# TempDesk Lite: a Samba 4 Active Directory domain controller with the
# TempDesk agent API built in. No secrets are baked into this image.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      samba samba-ad-dc samba-ad-provision samba-dsdb-modules samba-vfs-modules \
      winbind libnss-winbind libpam-winbind krb5-user ldb-tools smbclient \
      python3 python3-samba python3-ldb \
      supervisor tini openssl ca-certificates acl attr dnsutils procps iproute2 \
 && rm -rf /var/lib/apt/lists/* \
 # Debian ships a default smb.conf and krb5.conf: provisioning writes its own.
 && rm -f /etc/samba/smb.conf \
 && mkdir -p /opt/tempdesk /var/lib/tempdesk /var/log/supervisor

COPY agent/ /opt/tempdesk/agent/
COPY rootfs/ /
RUN chmod 0755 /usr/local/sbin/tempdesk-entrypoint /usr/local/sbin/tempdesk-provision \
               /usr/local/sbin/tempdesk-healthcheck /usr/local/sbin/tempdesk-agent-run \
 && python3 -m compileall -q /opt/tempdesk/agent

VOLUME ["/var/lib/samba", "/etc/samba", "/var/lib/tempdesk"]

# DNS, Kerberos, LDAP, SMB, RPC, GC, NTP, agent API
EXPOSE 53/tcp 53/udp 88/tcp 88/udp 123/udp 135/tcp 137/udp 138/udp 139/tcp 389/tcp 389/udp \
       445/tcp 464/tcp 464/udp 636/tcp 3268/tcp 3269/tcp 8443/tcp

HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=3 \
  CMD ["/usr/local/sbin/tempdesk-healthcheck"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/sbin/tempdesk-entrypoint"]
