#!/bin/sh
# 5G 模块温度取法测试。
#
# 覆盖两条通道：
#   ① 缓存文件（上游既有路径）
#   ② ubus → MT5700 Console 的 Rust 后端（本次新增，AT^CHIPTEMP?）
# ② 用**假 ubus**（塞到 PATH 最前面）在离线环境里验证，不依赖真机与真实模组。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONTROLLER="${ROOT}/root/usr/sbin/h5000m-fancontrol"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT INT TERM

# 假 ubus：只认 mt5700 at 这一次调用，响应内容由 UBUS_REPLY 决定
mkdir -p "${TMP}/bin"
cat > "${TMP}/bin/ubus" <<'FAKE'
#!/bin/sh
printf '%s\n' "${UBUS_REPLY}"
FAKE
chmod +x "${TMP}/bin/ubus"

# ---------------------------------------------------------------- ① 缓存通道
now="$(date +%s)"
printf 'temperature=43.6\ntemperature_sensor=modem2\nupdated=%s\n' "${now}" > "${TMP}/temperature"

# 新鲜缓存：读到 44℃（43.6 四舍五入），并把最热那一路的名字一起带出来
output="$(H5000M_FAN_MODULE_TEMP_SOURCE=cache H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/temperature" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp=44'
printf '%s\n' "${output}" | grep -qx 'module_sensor=modem2'

# 过期缓存（61s > MT5700M_TEMP_MAX_AGE=60）：必须判为空，不拿旧值控风扇
stale=$((now - 61))
printf 'temperature=43.6\ntemperature_sensor=modem2\nupdated=%s\n' "${stale}" > "${TMP}/temperature"
output="$(H5000M_FAN_MODULE_TEMP_SOURCE=cache H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/temperature" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp='

# ------------------------------------------------------- ② ubus → Rust 后端
# 12 路里 modem2（第 10 路，值 410 = 41.0℃）最热
UBUS_REPLY='{
	"data": "^CHIPTEMP: 402,401,397,403,380,380,400,400,400,410,380,380\r\nOK",
	"error": null,
	"success": true
}'
export UBUS_REPLY
out_file="${TMP}/ubus-cache/temperature"
output="$(PATH="${TMP}/bin:${PATH}" H5000M_FAN_MODULE_TEMP_SOURCE=ubus H5000M_FAN_MT5700M_TEMP_CACHE="${out_file}" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp=41'
printf '%s\n' "${output}" | grep -qx 'module_sensor=modem2'
# 查到之后应回写缓存，格式与上游一致（别的组件也能直接读）
[ -f "${out_file}" ] || { echo 'cache file was not written' >&2; exit 1; }
grep -qx 'temperature=41' "${out_file}"
grep -qx 'temperature_sensor=modem2' "${out_file}"
grep -q '^updated=[0-9][0-9]*$' "${out_file}"

# 无效读数 65535 必须跳过：否则会算出 6553℃ 并把风扇拉满
UBUS_REPLY='{
	"data": "^CHIPTEMP: 65535,65535,65535,65535,65535,65535,65535,65535,65535,410,380,380\r\nOK",
	"error": null,
	"success": true
}'
export UBUS_REPLY
output="$(PATH="${TMP}/bin:${PATH}" H5000M_FAN_MODULE_TEMP_SOURCE=ubus H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/ubus-cache2/temperature" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp=41'

# success=false：就算带了 data 也不能用（后端可能回的是错误或过期串）
UBUS_REPLY='{
	"data": "^CHIPTEMP: 900,900,900,900,900,900,900,900,900,900,900,900\r\nOK",
	"error": "modem busy",
	"success": false
}'
export UBUS_REPLY
output="$(PATH="${TMP}/bin:${PATH}" H5000M_FAN_MODULE_TEMP_SOURCE=ubus H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/ubus-cache3/temperature" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp='

# ------------------------------------------------------------- ③ 来源开关
# off：模块温度完全不参与取热
output="$(H5000M_FAN_MODULE_TEMP_SOURCE=off H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/temperature" sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp='

# ------------------------------------------- ④ ubus 拿不到时退回"偏旧"缓存
# 缓存 age=45s：过了刷新间隔 30s（该打 AT 了），但没过硬上限 60s。
# 假 ubus 返回 garbage 模拟后端不可用 —— 此时应继续用旧值，而不是让风扇失据。
UBUS_REPLY='garbage'
export UBUS_REPLY
age45=$((now - 45))
printf 'temperature=39.0\ntemperature_sensor=ap1\nupdated=%s\n' "${age45}" > "${TMP}/temperature-stale"
output="$(PATH="${TMP}/bin:${PATH}" H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/temperature-stale" H5000M_FAN_MODULE_TEMP_INTERVAL=30 sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp=39'
printf '%s\n' "${output}" | grep -qx 'module_sensor=ap1'

echo 'module temperature tests passed'
