#!/bin/sh
# 厂商无线温度「节流缓存」测试。
#
# 取值正确性、0–125°C 边界、原生 sensor 优先、命令失败降级，已由
# test-vendor-temperature.sh（上游）覆盖。这里只钉住叠加在上面的节流层：
#   interval = 0  → 每轮都问驱动（与上游行为一致，测试可预期）
#   interval > 0  → 新鲜期内不再问驱动；过期后再问；驱动挂掉退回未过期旧值；
#                   旧值也过期则判为"没读到"，绝不当 0℃ 参与取热。
#
# 用假 iwpriv + 假 sysfs 根离线跑，不依赖真机与真实驱动。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONTROLLER="${ROOT}/root/usr/sbin/h5000m-fancontrol"
TMP="$(cd "$(mktemp -d)" && pwd)"
cleanup() {
	rm -f "${TMP}/functions" "${TMP}/calls" 2>/dev/null || true
	rm -f "${TMP}"/cache/* 2>/dev/null || true
	rm -f "${TMP}"/sys/class/hwmon/hwmon1/* 2>/dev/null || true
	rmdir "${TMP}"/cache "${TMP}"/sys/class/hwmon/hwmon1 "${TMP}"/sys/class/hwmon \
		"${TMP}"/sys/class "${TMP}"/sys "${TMP}"/net/ra0 "${TMP}"/net/rai0 "${TMP}"/net "${TMP}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 只取函数定义，不执行末尾的 case 分发 —— 测试绝不能真的去写风扇 PWM。
sed '/^case /,$d' "${CONTROLLER}" > "${TMP}/functions"

export H5000M_FAN_SENSOR_SYSFS_ROOT="${TMP}/sys"
export H5000M_FAN_RADIO_SYSFS_ROOT="${TMP}/net"
export H5000M_FAN_WIFI_TEMP_CACHE="${TMP}/cache/wifi"
mkdir -p "${TMP}/net/ra0" "${TMP}/net/rai0" "${TMP}/cache" "${TMP}/sys"

. "${TMP}/functions"
find_module_temp() { :; }
# load_config 才设这两个，这里直接给定，保证 max 取热路径被走到
TEMP_SOURCE=max
WIFI_TEMP_INTERVAL=0

# 驱动替身：返回固定温度并记录调用次数
iwpriv() {
	echo "$1" >> "${TMP}/calls"
	[ "${DOWN:-0}" = "1" ] && return 1
	printf 'CurrentTemperature = %s\n' "${TVAL:-42}"
}
# 本地 Git Bash 带的是 Windows 的 timeout.exe，语义完全不同，统一抹平
timeout() { shift; "$@"; }

count_calls() { wc -l < "${TMP}/calls" 2>/dev/null | tr -d ' ' || echo 0; }
reset_calls() { : > "${TMP}/calls"; }

# ------------------------------------------- ① interval=0：每轮都问两个接口
WIFI_TEMP_INTERVAL=0
reset_calls
read_sensors
[ "$(count_calls)" = 2 ] || { echo "interval=0: expected 2 driver calls, got $(count_calls)" >&2; exit 1; }
[ "${WIFI1_TEMP}" = 42 ] && [ "${WIFI2_TEMP}" = 42 ] || { echo 'both interfaces should read 42' >&2; exit 1; }
read_sensors
[ "$(count_calls)" = 4 ] || { echo 'interval=0 must query the driver every round' >&2; exit 1; }

# ------------------------------------------- ② interval>0：新鲜期内复用缓存
WIFI_TEMP_INTERVAL=30
reset_calls
read_sensors
[ "$(count_calls)" = 2 ] || { echo 'first round must query once per interface' >&2; exit 1; }
read_sensors
[ "$(count_calls)" = 2 ] || { echo 'throttled round still queried the driver' >&2; exit 1; }
[ "${WIFI1_TEMP}" = 42 ] || { echo 'cached value not returned' >&2; exit 1; }

# ------------------------------------------- ③ 缓存过期后重新问一次驱动
for f in "${TMP}"/cache/wifi.*; do
	sed 's/^updated=.*/updated=1/' "$f" > "${f}.new" && mv -f "${f}.new" "$f"
done
TVAL=55 read_sensors
[ "${WIFI1_TEMP}" = 55 ] || { echo 'expired cache must be refreshed from the driver' >&2; exit 1; }

# ------------------------------------------- ④ 驱动挂掉：退回未过上限的旧值
DOWN=1 read_sensors
[ "${WIFI1_TEMP}" = 55 ] || { echo 'stale cache should still be used when the driver is down' >&2; exit 1; }

# ------------------------------------------- ⑤ 旧值也过期：判为没读到，不是 0
for f in "${TMP}"/cache/wifi.*; do
	sed 's/^updated=.*/updated=1/' "$f" > "${f}.new" && mv -f "${f}.new" "$f"
done
DOWN=1 read_sensors
[ -z "${WIFI1_TEMP}" ] || { echo 'expired cache must not be used' >&2; exit 1; }
[ -z "${WIFI2_TEMP}" ] || { echo 'wifi2 should also be unavailable' >&2; exit 1; }
[ "${WIFI_SOURCE}" = none ] || { echo "expected wifi_source=none, got ${WIFI_SOURCE}" >&2; exit 1; }

# ------------------------------------------- ⑥ 关闭开关：一次都不问驱动
# 配置项存在但没人读，就是"死开关"；这条断言专门防它回退。
WIFI_TEMP_SOURCE=off
WIFI_TEMP_INTERVAL=30
reset_calls
read_sensors
[ -z "${WIFI1_TEMP}${WIFI2_TEMP}" ] || { echo 'wifi_temp_source=off still produced readings' >&2; exit 1; }
[ "$(count_calls)" = 0 ] || { echo 'wifi_temp_source=off still queried the driver' >&2; exit 1; }

# ------------------------------------------- ⑦ 原生 hwmon 优先：不再问驱动
mkdir -p "${TMP}/sys/class/hwmon/hwmon1"
printf 'mt7996\n' > "${TMP}/sys/class/hwmon/hwmon1/name"
printf '61000\n' > "${TMP}/sys/class/hwmon/hwmon1/temp1_input"
WIFI_TEMP_INTERVAL=30
reset_calls
read_sensors
[ "${WIFI1_TEMP}" = 61 ] || { echo 'native hwmon reading should win' >&2; exit 1; }
# WIFI1 已由 hwmon 满足，就绝不能再为它去问驱动；另一路（rai0）仍走回退，属正常。
[ "$(count_calls)" -le 1 ] || { echo 'driver queried for an interface already covered by hwmon' >&2; exit 1; }
! grep -qx 'ra0' "${TMP}/calls" || { echo 'ra0 must not be queried when hwmon already provides it' >&2; exit 1; }
[ "${WIFI_SOURCE}" = hwmon ] || { echo "expected wifi_source=hwmon, got ${WIFI_SOURCE}" >&2; exit 1; }

echo 'wifi throttle tests passed'
