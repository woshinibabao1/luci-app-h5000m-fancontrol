# Changelog

## 2.2.1

### 5G 模块数据收敛到唯一来源：MT5700 Console

- 移除对**其它模组管理软件**缓存的读取（`/tmp/cache_base_info_*` / `/tmp/cache_*info*`）。
  那既不是 MT5700 Console 的取数链路，本机也不存在。模块温度现在只可能来自
  `ubus call mt5700 at '{"cmd":"AT^CHIPTEMP?"}'`。
- 模块温度缓存改到本插件自己的命名空间 `/var/run/h5000m-fancontrol.temperature`。
  该文件既是写目标、也是 `auto` 模式下的读来源；留在 `/var/run/mt5700m/`（被本机型
  构建明确排除的 `luci-app-mt5700m` 命名空间）就可能读到第三方写进去的数值。
  旧环境变量 `H5000M_FAN_MT5700M_TEMP_CACHE` 仍被承认，新名 `H5000M_FAN_TEMP_CACHE` 优先。
- 新增静态守卫：ubus 调用必须全部指向 `mt5700`、不得出现其它模组管理软件的缓存路径、
  不得直接开串口（判据跑在**去注释后的源码**上，避免被注释里的 `/dev/ttyUSB1` 顶住）。

### 性能：单轮外部进程数 −30%

真机实测（H5000M）：`status` 137 → **96** 个外部进程、耗时 330–400ms → **270–310ms**；
`apply` 136 → **95**、340–360ms → **270–280ms**。

- UCI 读取改走 `/lib/functions.sh` 的 `config_load` / `config_get`：`load_config` 的
  17 次 `uci -q get` 全部归零。真机逐项核对 18 个选项取值一致、缺项行为一致；
  非 OpenWrt 环境（CI 单元测试）没有该文件，退回 `uci` 命令行，行为与改动前一致。
- `set_thermal_floor` 里 trip 的 phandle 索引只建一次。原先内层循环对每个属于风扇的
  cooling-map 都把全部 trip 重扫一遍 —— 实测 36 次设备树读取里有 18 次是这样重复出来的。
  设备树在一次开机内只读且不变，索引不存在过期问题。
- **行为等价性已在真机验证**：`set_thermal_floor` 在 0–130 ℃ 的 131 个采样点上
  `state` / `floor` / `owner` / `max` 与原实现逐项一致；再隔离兜底分支单独验证设备树
  路径，三个故意注入的变异全部判红 —— 证明这套等价性验证手段有边界级灵敏度。
- 被淘汰的方案：用 `hexdump -s/-n` 取代 `dd | hexdump`（可再省一半进程）。
  真机 A/B 证明**不等价**：`busybox hexdump -s` 在偏移 ≥ 文件大小时与 `dd` 行为不同，
  旧实现安全地返回空串、新实现会静默返回错误数值，属正确性退化，故放弃。

### 测试与可维护性

- **`tests/test-thermal-policy-safety.sh` 此前全仓没有任何引用 —— 写了但从未被执行。**
  现已接入 CI 真正执行。
- 该测试原先有一条断言钉的是**注释文字**（`grep -q 'kernel must'`）：改说明就会误报，
  且证明不了任何行为。已换成行为断言（不写 `user_space`、恢复路径的两个调用点在位、
  恢复函数确实把 policy 写回）。
- 修掉一处不可达代码（`find_module_temp` 末尾重复的 `return 0`）。
- 修正 `README` 的版本表述（最近发布是 `v2.1.0`，源码树为 `2.2.1`）。
- LuCI：去掉赋值后从未使用的 `lastStatus`；修正 `renderForm` 中 `m.handleSaveApply`
  的缩进层级。

## 2.2.0

- **5G 模块温度改为经 ubus 向 MT5700 Console 的 Rust 后端查询**（`AT^CHIPTEMP?`）。
  原先只读 `/var/run/mt5700m/temperature` 这一条路 —— 该文件由别的模组管理软件
  产生，在这台机器上**根本不存在**，于是模块温度恒为空、从不参与取热。
- 取法改为三级：新鲜缓存 → ubus 查询 → 旧缓存兜底，并保留原先的 `/tmp` 兜底扫描。
- 查询结果按上游既有格式回写缓存文件，`temperature_sensor` 记下最热的那一路，
  其他组件（以及本插件的下一次循环）可以直接读。
- 新增 `module_temp_interval`（默认 30 秒）：风扇主循环是 5 秒一轮，没有这个节流
  就会每 5 秒占用一次 AT 通道。
- 新增 `module_temp_source`（`auto`/`cache`/`ubus`/`off`）：可强制只用缓存或彻底关闭。
- 无效读数 65535 会被跳过（否则会算出 6553℃ 并把风扇拉满）。
- 状态新增 `module_sensor` 字段，界面提示改为显示最热通道；`module_label` 仍是
  `5G modem`（界面靠它高亮传感器卡片，改名会让高亮失效）。

## 2.1.0

- 风扇控制器不再把完整 CPU thermal zone 切换到 `user_space`。
- 自动恢复旧版本遗留的 thermal policy，并保留 CPU 降频和高温保护。
- 状态读取与控制写入使用独立 RPC 权限。
- 将 UCI 配置声明为升级保留文件。

## 2.0.2

- 读取 MT5700M 管理器提供的带时间戳温度缓存。
- 忽略超过 60 秒的陈旧模组温度，并兼容旧 QModem 缓存。

## 2.0.1

- 统一 GitHub Release 与 OpenWrt 软件包版本规则。
- 汇总 2.0.0 后的构建兼容性与交付修订。

## 2.0.0

- 重新设计面向最终用户的 LuCI 散热管理界面
- 增加 CPU、以太网 PHY、Wi-Fi 和 5G 模块温度汇总
- 增加静音、均衡、性能及自定义风扇曲线
- 增加温度滞回、降速延迟和启动助推
- 增加传感器故障保护及高温用户空间安全下限
- 增加可选 H5000M 设备树补丁，避免内核与用户空间争用 PWM
