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
TMP="$(cd "$(mktemp -d)" && pwd)"
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
# 缓存 age 比刷新间隔大（该打 AT 了），但仍在硬上限内 —— 此时应继续用旧值，
# 而不是让风扇失据。假 ubus 返回 garbage 模拟后端不可用。
#
# ★ 必须显式把硬上限放大：从写文件到跑完控制器要花几秒（CI 上约 2 秒，慢机器十几秒），
#   而默认窗口只有 60-30=30 秒宽 —— 窗口一漂出去，这条用例就会「因为测试跑得慢」
#   而变红。守卫不能因计时而不稳定（这正是它以前只在 CI 上绿的原因）。
UBUS_REPLY='garbage'
export UBUS_REPLY
printf 'temperature=39.0\ntemperature_sensor=ap1\nupdated=%s\n' "$((now - 45))" > "${TMP}/temperature-stale"
output="$(PATH="${TMP}/bin:${PATH}" H5000M_FAN_MT5700M_TEMP_CACHE="${TMP}/temperature-stale" \
	H5000M_FAN_MODULE_TEMP_INTERVAL=30 H5000M_FAN_MT5700M_TEMP_MAX_AGE=600 \
	sh "${CONTROLLER}" status 2>/dev/null)"
printf '%s\n' "${output}" | grep -qx 'module_temp=39'
printf '%s\n' "${output}" | grep -qx 'module_sensor=ap1'

# ------------------------------------------------ ⑤ 取数来源只允许 MT5700 Console
# 5G 模块数据只有一条来源。三条静态断言各对应一种「绕过 Console」的写法：
#   · 读别的模组管理软件留下的 /tmp 缓存（旧版本有，已移除）
#   · ubus 调用的目标不是 mt5700
#   · 自己开串口（/dev/ttyUSB1 的唯一持有者是 Console 的 Rust 服务）
# 判据跑在**去注释后的源码**上 —— 控制器里正好有注释提到 /dev/ttyUSB1，
# 直接 grep 会把它当成真调用（注释必须显式排除）。
code="$(awk '!/^[[:space:]]*#/' "${CONTROLLER}")"

if printf '%s\n' "${code}" | grep -qE '/tmp/cache_base_info|/tmp/cache_[^ ]*info'; then
	echo 'module data must not come from other modem managers caches' >&2
	exit 1
fi
if printf '%s\n' "${code}" | grep -E 'ubus[[:space:]]+call' | grep -qvE 'ubus[[:space:]]+call[[:space:]]+mt5700[[:space:]]'; then
	echo 'every ubus call must target mt5700 (MT5700 Console)' >&2
	exit 1
fi
if printf '%s\n' "${code}" | grep -qE '/dev/tty[A-Za-z0-9]*'; then
	echo 'the controller must not open the serial port directly' >&2
	exit 1
fi

echo 'module temperature tests passed'
