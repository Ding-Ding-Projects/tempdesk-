#!/bin/sh
set -eu

platform="$1"
version="$2"
case "$platform:$(apk --print-arch)" in
    x86_64:x86_64) kernel=virt; firmware=; boot_tools=grub-efi ;;
    rpi4-arm64:aarch64) kernel=rpi; firmware=raspberrypi-bootloader; boot_tools= ;;
    *) echo "The builder architecture does not match $platform." >&2; exit 1 ;;
esac

# All filesystem constructors below operate on new regular files in the container.
apk add --no-cache coreutils e2fsprogs dosfstools mtools sfdisk uuidgen mkinitfs jq skopeo $boot_tools
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
root="$work/root"
boot="$work/boot"
mkdir -p "$root/etc/apk/keys" "$boot"
cp /etc/apk/repositories "$root/etc/apk/repositories"
cp /etc/apk/keys/* "$root/etc/apk/keys/"
apk --root "$root" --initdb --no-cache add alpine-base "linux-$kernel" $firmware \
    ca-certificates docker docker-cli-compose docker-openrc e2fsprogs blkid \
    iproute2 iptables python3

serial='console=ttyS0,115200n8'
root_uuid="$(uuidgen)"
state_uuid="$(uuidgen)"
case "$platform" in
    rpi4-arm64)
        disk_id="$(uuidgen | cut -c1-8)"
        serial='console=serial0,115200n8'
        ;;
esac
tee "$root/etc/fstab" >/dev/null <<EOF
UUID=$root_uuid / ext4 rw,noatime 0 1
UUID=$state_uuid /var/lib/tempdesk ext4 rw,noatime,nodev,nosuid 0 2
/var/lib/tempdesk/containerd /var/lib/containerd none bind 0 0
EOF
printf '%s\n' 'tempdesk' > "$root/etc/hostname"
printf '%s\n' '127.0.0.1 localhost tempdesk' '::1 localhost' > "$root/etc/hosts"
state_files="$work/state"
mkdir -p "$root/opt/tempdesk" "$root/etc/docker" "$root/etc/network" \
    "$root/var/lib/tempdesk" "$root/var/lib/containerd" "$state_files/containerd"
tee "$root/etc/network/interfaces" >/dev/null <<'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF
tee "$root/etc/docker/daemon.json" >/dev/null <<'EOF'
{"data-root":"/var/lib/tempdesk/docker","log-driver":"local","userland-proxy":false}
EOF
printf '%s\n' 'rc_need="localmount"' >> "$root/etc/conf.d/docker"
cp /inputs/portal/compose.yaml /inputs/portal/compose.published.yaml "$root/opt/tempdesk/"
cp /inputs/appliance/compose.appliance.yaml /inputs/appliance/appliance-config.py "$root/opt/tempdesk/"
cp /inputs/publication.json "$root/opt/tempdesk/publication.json"
jq -er '.portalIndex | split("@")[1] | select(test("^sha256:[0-9a-f]{64}$"))' \
    /inputs/publication.json > "$root/opt/tempdesk/portal-digest"
portal_repo="$(jq -er '.portalIndex | split("@")[0] | select(. == "ghcr.io/ding-ding-projects/tempdesk-portal")' /inputs/publication.json)"
portal_child="$(jq -er '.portalChild | select(test("^sha256:[0-9a-f]{64}$"))' /inputs/publication.json)"
archive="$root/opt/tempdesk/portal-image.tar"
skopeo copy --preserve-digests --retry-times 2 "docker://$portal_repo@$portal_child" "oci-archive:$archive"
tar -xOf "$archive" index.json | jq -e --arg child "$portal_child" \
    '.manifests | length == 1 and .[0].digest == $child' >/dev/null
archive_hash="$(sha256sum "$archive" | cut -d ' ' -f1)"
printf '%s\n' "$portal_child" > "$root/opt/tempdesk/portal-child"
printf '%s  /opt/tempdesk/portal-image.tar\n' "$archive_hash" > "$root/opt/tempdesk/portal-image.sha256"
install -m 0755 /inputs/appliance/tempdesk-appliance.rc "$root/etc/init.d/tempdesk-appliance"

# Credentials arrive only on a separately prepared configuration volume.
sed -i 's/^root:[^:]*:/root:!:/' "$root/etc/shadow"
for entry in sysinit/devfs sysinit/dmesg sysinit/mdev sysinit/hwdrivers \
    boot/modules boot/sysctl boot/hostname boot/bootmisc boot/syslog boot/localmount \
    default/networking default/tempdesk-appliance shutdown/mount-ro shutdown/killprocs; do
    service="${entry#*/}"
    test -x "$root/etc/init.d/$service"
    ln -snf "/etc/init.d/$service" "$root/etc/runlevels/$entry"
done

features='ata base ext4 mmc nvme scsi usb virtio'
printf 'features="%s"\n' "$features" > "$work/mkinitfs.conf"
set -- "$root"/lib/modules/*
[ "$#" -eq 1 ] && [ -d "$1" ]
mkinitfs -c "$work/mkinitfs.conf" -b "$root" -o "$boot/initramfs" "${1##*/}"
cp "$root/boot/vmlinuz-$kernel" "$boot/kernel"
arguments="root=UUID=$root_uuid rootfstype=ext4 rw rootwait net.ifnames=0 console=tty0 $serial"
if [ "$platform" = x86_64 ]; then
    mkdir -p "$boot/EFI/BOOT"
    tee "$work/grub.cfg" >/dev/null <<EOF
serial --unit=0 --speed=115200
terminal_output console serial
linux (memdisk)/boot/tempdesk/kernel $arguments
initrd (memdisk)/boot/tempdesk/initramfs
boot
EOF
    grub-mkstandalone -O x86_64-efi -o "$boot/EFI/BOOT/BOOTX64.EFI" \
        "boot/grub/grub.cfg=$work/grub.cfg" \
        "boot/tempdesk/kernel=$boot/kernel" "boot/tempdesk/initramfs=$boot/initramfs"
    rm -f "$boot/kernel" "$boot/initramfs"
else
    # The firmware and model-specific device tree come from signed Alpine packages.
    # Keep the single generated kernel and initramfs already staged above.
    install -m 0644 "$root/boot/start4.elf" "$root/boot/fixup4.dat" \
        "$root/boot/bcm2711-rpi-4-b.dtb" "$boot/"
    tee "$boot/config.txt" >/dev/null <<'EOF'
[all]
arm_64bit=1
enable_uart=1
kernel=kernel
initramfs initramfs followkernel
EOF
    printf '%s\n' "$arguments" > "$boot/cmdline.txt"
fi

esp="$work/boot.fat"
rootfs="$work/root.ext4"
statefs="$work/state.ext4"
disk="$work/appliance.img"
truncate -s 96M "$esp"
truncate -s 1024M "$rootfs"
truncate -s 3072M "$statefs"
truncate -s 4194M "$disk"
mkfs.vfat -F 32 -n TDBOOT "$esp"
mcopy -i "$esp" -s "$boot"/* ::/
mkfs.ext4 -q -F -m 0 -L TDROOT -U "$root_uuid" -d "$root" "$rootfs"
mkfs.ext4 -q -F -m 0 -L TDSTATE -U "$state_uuid" -d "$state_files" "$statefs"
if [ "$platform" = x86_64 ]; then
    sfdisk "$disk" <<EOF
label: gpt
unit: sectors
start=2048, size=196608, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name="TempDesk boot"
start=198656, size=2097152, type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, uuid=$root_uuid, name="TempDesk system"
start=2295808, size=6291456, type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, uuid=$state_uuid, name="TempDesk state"
EOF
else
    sfdisk "$disk" <<EOF
label: dos
label-id: 0x$disk_id
unit: sectors
start=2048, size=196608, type=c, bootable
start=198656, size=2097152, type=83
start=2295808, size=6291456, type=83
EOF
fi
dd if="$esp" of="$disk" bs=1M seek=1 conv=notrunc,sparse status=none
dd if="$rootfs" of="$disk" bs=1M seek=97 conv=notrunc,sparse status=none
dd if="$statefs" of="$disk" bs=1M seek=1121 conv=notrunc,sparse status=none
apk --root "$root" info -v | sort > /output/packages.txt
printf '%s\n' "$archive_hash" > /output/portal-archive.sha256
artifact="/output/TempDesk-Appliance-$version-$platform.img.gz"
gzip -1 -n -c "$disk" > "$artifact.part"
mv "$artifact.part" "$artifact"
printf '%s\n' "$artifact"
