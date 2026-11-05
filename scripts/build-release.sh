#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="${RUNNER_TEMP:-/tmp}/h5000m-fan-sdk"
output_dir="${repo_dir}/dist-release"

# 包格式：默认 apk，PKG_FORMAT=ipk 时产出 opkg 能装的 .ipk。
#
# ★ 实现方式是「换 SDK」，不是「关 CONFIG_USE_APK」。
#   24.10-SNAPSHOT 的 SDK 里 config USE_APK（config/Config-build.in:71）
#   默认 y，语义是「用 apk 代替 opkg」。实测往 .config 写
#   "# CONFIG_USE_APK is not set" 后defconfig 结束仍是 CONFIG_USE_APK=y，
#   符号关不掉；而 23.05 的 SDK 里根本不存在它，opkg 是默认，格式天然 ipk。
#   姊妹项目 luci-app-h5000m-netmode 与 MT5700 Console 都是这么分的
#   （main→apk、23.05→ipk），本项目沿用同一做法。
#   ★ 出 ipk 时还有一处必须一起改：apk/ipk 的文件名分隔符不同
#     （apk 用 -、ipk 用 _），find 通配写错会把「已出 ipk」误报成「没出」，
#     详见下方产物校验处。
pkg_format="${PKG_FORMAT:-apk}"
case "${pkg_format}" in
	apk) sdk_ver='snapshots'; ext='apk' ;;
	ipk) sdk_ver='23.05.5';   ext='ipk' ;;
	*) echo "不支持的 PKG_FORMAT=${pkg_format}（只支持 apk / ipk）" >&2; exit 2 ;;
esac

case "${sdk_ver}" in
	snapshots) base_url="https://downloads.openwrt.org/snapshots/targets/mediatek/filogic" ;;
	*)         base_url="https://downloads.openwrt.org/releases/${sdk_ver}/targets/mediatek/filogic" ;;
esac

mkdir -p "${work_dir}" "${output_dir}"
find "${output_dir}" -mindepth 1 -maxdepth 1 -delete
cd "${work_dir}"
curl -fsSLO "${base_url}/sha256sums"
archive="$(awk '/openwrt-sdk-.*Linux-x86_64\.tar\.(xz|zst)$/ { print $2; exit }' sha256sums | sed 's/^\*//')"
test -n "${archive}"
curl -fL --retry 5 "${base_url}/${archive}" -o "${archive}"
grep "[ *]${archive}$" sha256sums | sha256sum -c -
# 两代 SDK 的压缩格式不同：23.05 是 .tar.xz，snapshot 是 .tar.zst。
case "${archive}" in
	*.tar.zst) tar --zstd -xf "${archive}" ;;
	*.tar.xz)  tar -xJf "${archive}" ;;
	*) echo "未知的 SDK 压缩格式：${archive}" >&2; exit 2 ;;
esac
sdk_dir="$(find "${work_dir}" -maxdepth 1 -type d -name 'openwrt-sdk-*' | head -n 1)"
test -n "${sdk_dir}"

cd "${sdk_dir}"
./scripts/feeds update -a
./scripts/feeds install luci-base

perl -0pi -e 's/(config ALL\n\s+bool "Select all userspace packages by default"\n\s+default )y/${1}n/' Config.in
perl -0pi -e 's/(config TARGET_MULTI_PROFILE\n\s+bool\n\s+default )y/${1}n/; s/(config TARGET_ALL_PROFILES\n\s+bool\n\s+default )y/${1}n/; s/(config TARGET_DEVICE_mediatek_filogic_DEVICE_[^\n]+\n\s+bool\n\s+default )y/${1}n/g' Config-build.in
sed -i 's/^[[:space:]]*default m$/\tdefault n/' Config-build.in

mkdir -p package/h5000m-custom
rsync -a --exclude '.git/' --exclude '.github/' --exclude 'scripts/' --exclude 'dist/' --exclude 'dist-release/' "${repo_dir}/" package/h5000m-custom/luci-app-h5000m-fancontrol/
cat > .config <<'EOF'
CONFIG_TARGET_mediatek=y
CONFIG_TARGET_mediatek_filogic=y
# CONFIG_ALL is not set
# CONFIG_ALL_KMODS is not set
# CONFIG_ALL_NONSHARED is not set
CONFIG_PACKAGE_luci-app-h5000m-fancontrol=m
CONFIG_LUCI_LANG_zh_Hans=y
EOF
make defconfig
make package/h5000m-custom/luci-app-h5000m-fancontrol/compile -j"$(nproc)" V=s

# ★ 必须钉住扩展名。原来只数「apk 或 ipk 至少 2 个」，于是格式没生效时
#   拿到的仍是另一种扩展名，校验照样通过 —— 需求(ipk)与产物(apk)对不上
#   却报绿灯。现在按请求格式精确匹配。
# ★ 通配必须到扩展名之前，不能写 "包名-*.*${ext}"：那串 "-*.*" 假定版本
#   前有连字符，而 ipk 用下划线分隔（luci-app-..._2.2.1_all.ipk），
#   写成那样 ipk 明明在 bin 里也会匹配到 0 个 —— 「已出 ipk」被误报成
#   「没出 ipk」。姊妹项目 netmode 已在真机上踩过并修好。
found="$(find bin -type f \( -name "luci-app-h5000m-fancontrol*.${ext}" \
	-o -name "luci-i18n-h5000m-fancontrol-zh-cn*.${ext}" \) | wc -l)"
if [ "${found}" -lt 2 ]; then
	echo "错误：请求格式 ${ext}，但 bin 下只找到 ${found} 个 .${ext} 包" >&2
	find bin -type f \( -name '*h5000m-fancontrol*' \) | sed 's/^/  实际产物: /' >&2
	exit 1
fi

find bin -type f \( -name "luci-app-h5000m-fancontrol*.${ext}" \
	-o -name "luci-i18n-h5000m-fancontrol-zh-cn*.${ext}" \) -exec cp -f {} "${output_dir}/" \;
test "$(find "${output_dir}" -type f -name "*.${ext}" | wc -l)" -ge 2

# apk 必须显式签名并当场验签：CI 装出来的 SDK 私钥只在这台机器上，
# 用 --allow-untrusted 接受自己刚打的包，再用只含公钥的 keys-dir 验回来。
# ipk 走 opkg，没有这一步。
if [ "${ext}" = "apk" ] && [ -f private-key.pem ] && [ -x staging_dir/host/bin/apk ]; then
	mkdir -p "${work_dir}/verification-keys"
	cp public-key.pem "${work_dir}/verification-keys/build.pem"
	for package in "${output_dir}"/*.apk; do
		staging_dir/host/bin/apk adbsign --allow-untrusted --sign-key private-key.pem "$package"
		staging_dir/host/bin/apk --keys-dir "${work_dir}/verification-keys" verify "$package"
	done
else
	echo "NOTE: 跳过 apk 签名（非 apk 产物或 SDK 未生成密钥）"
fi

# 签名公钥：仅在 SDK 自己生成时才带出去。23.05 默认不开
# SIGN_EACH_PACKAGE，SDK 根目录没有 public-key.pem，无条件 cp 会以
# "cannot stat 'public-key.pem'" 失败 —— 而此时包已打好、闸门也已通过。
if [ -f public-key.pem ]; then
	cp public-key.pem "${output_dir}/openwrt-sdk-build.pem"
else
	echo "NOTE: SDK 未生成 public-key.pem（未开启签名），产物不附带公钥"
fi

# 产物来源可追溯：哪个 SDK、哪个提交、SDK 自身的校验值，一起写进 BUILD-INFO。
printf 'SDK=%s
SOURCE_COMMIT=%s
TARGET=mediatek/filogic
' "${sdk_ver}" \
	"$(git -C "${repo_dir}" rev-parse HEAD)" > "${output_dir}/BUILD-INFO.txt"
grep "[ *]${archive}$" "${work_dir}/sha256sums" >> "${output_dir}/BUILD-INFO.txt" || true

(cd "${output_dir}" && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
