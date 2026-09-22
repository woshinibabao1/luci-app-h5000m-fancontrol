# H5000M Fan Control

[![CI](https://github.com/FAN789/luci-app-h5000m-fancontrol/actions/workflows/ci.yml/badge.svg)](https://github.com/FAN789/luci-app-h5000m-fancontrol/actions/workflows/ci.yml)
[![Build Release](https://github.com/FAN789/luci-app-h5000m-fancontrol/actions/workflows/release.yml/badge.svg)](https://github.com/FAN789/luci-app-h5000m-fancontrol/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

面向 Hiveton H5000M 的 OpenWrt LuCI 风扇管理器。它提供温度监控、自动风扇曲线、手动 PWM、启停助推、温度滞回、降速延迟和传感器故障保护，并保留内核的 CPU 降频、高温及临界过热保护。

> H5000M fan manager for OpenWrt with temperature-aware profiles, manual PWM control, hysteresis, delayed spin-down, start boost and sensor failsafe protection.

版本采用标准的 `主版本.次版本.修订版本-r打包修订` 格式。GitHub Release 仅使用
语义版本标签（当前为 `v2.1.0`），OpenWrt 安装包版本为 `2.1.0-r1`。

![散热管理界面](docs/fan-control-ui.jpg)

## 功能

- 汇总 CPU、以太网 PHY、Wi-Fi 射频及 5G 模块温度（模块温度经 ubus 向 MT5700 Console 查询）
- 静音、均衡、性能和自定义四种自动曲线
- 自动、手动和仅内核保护三种运行模式
- 温度滞回及降速延迟，减少风扇频繁波动
- 风扇停转后的启动助推
- 传感器或曲线异常时自动进入高输出安全模式
- 简体中文 LuCI 界面
- 不依赖云服务，不收集或上传设备数据

## 兼容性

- Hiveton H5000M
- OpenWrt SNAPSHOT（基于 LuCI JavaScript 视图）
- `pwm-fan` 驱动及 `/sys/class/hwmon/*/pwm1` 控制节点

本项目针对 H5000M 的设备树和传感器布局设计。其他设备即使能够安装，也不建议直接使用。

## 集成到 OpenWrt 源码

在 OpenWrt 源码根目录执行：

```sh
git clone https://github.com/FAN789/luci-app-h5000m-fancontrol.git \
  package/luci-app-h5000m-fancontrol

make menuconfig
# LuCI -> Applications -> luci-app-h5000m-fancontrol

make package/luci-app-h5000m-fancontrol/compile V=s
```

GitHub Releases 中的预编译 `.apk` 由 GitHub Actions 使用官方 OpenWrt
SNAPSHOT `mediatek/filogic` SDK 构建，适用于同一 ABI 的近期 SNAPSHOT。Release
同时提供构建公钥和 SHA256 校验文件。由于风扇安全策略依赖设备树，建议把本项目
集成进固件并同时评估下方补丁，而不是只安装软件包。

## 独占风扇策略控制

H5000M 原设备树中的主动散热映射会与用户空间控制器同时修改 PWM。若希望自动曲线完整控制风扇，请在编译固件前应用项目提供的补丁：

```sh
git apply package/luci-app-h5000m-fancontrol/openwrt-patches/h5000m-userspace-fan-control.patch
```

该补丁仅删除 H5000M 的三个风扇 cooling-map；CPU 降频、hot 和 critical 温控节点仍然保留。控制器还会在 CPU 达到高温阈值时强制提高风扇输出。

不应用补丁时插件仍可运行，但内核 thermal governor 可能提高实际 PWM，因此界面中的请求输出和实际输出可能不同。

## 配置与服务

- UCI 配置：`/etc/config/h5000m_fancontrol`
- procd 服务：`/etc/init.d/h5000m-fancontrol`
- 控制器：`/usr/sbin/h5000m-fancontrol`
- LuCI 页面：系统 → 风扇控制

常用命令：

```sh
/usr/sbin/h5000m-fancontrol status
/usr/sbin/h5000m-fancontrol apply
/etc/init.d/h5000m-fancontrol restart
```

## 5G 模块温度

模块温度不是从文件里"碰巧读到"的，而是**经 ubus 向 MT5700 Console 的 Rust 后端**
（`at-webserver-rust`）发一次只读查询 `AT^CHIPTEMP?`，取 12 路传感器里的最大值：

```sh
ubus call mt5700 at '{"cmd":"AT^CHIPTEMP?"}'
# -> "data": "^CHIPTEMP: 401,400,396,402,370,370,400,400,400,410,380,380\r\nOK"
#    单位是 0.1℃，第 10 路 modem2 = 410 最高 → 41℃
```

取法依次是：新鲜缓存 → ubus 查询 → 未过硬上限的旧缓存 → `/tmp` 兜底扫描。
查询成功后会把结果按 `temperature` / `temperature_sensor` / `updated` 三行写回
`/var/run/mt5700m/temperature`，格式与此前版本一致。

为什么这么绕，而不是每轮都查：

- 风扇主循环是 **5 秒**一轮，每轮都打 AT 会持续占用 AT 通道。
  `module_temp_interval`（默认 **30 秒**）决定真正打 AT 的频率，其余轮次读缓存。
- `/dev/ttyUSB1` 的唯一持有者是那个 Rust 服务，脚本自己开串口会把 AT 通道抢坏，
  所以必须走 ubus → rpcd ucode → 后端的同一条链路。
- 模组报告的无效读数 **65535** 会被跳过。

相关 UCI 选项（`/etc/config/h5000m_fancontrol`）：

| 选项 | 默认 | 说明 |
|---|---|---|
| `module_temp_source` | `auto` | `auto` 三级回退；`cache` 只用缓存（完全不碰 AT）；`ubus` 只走查询；`off` 不取模块温度 |
| `module_temp_interval` | `30` | 两次 `AT^CHIPTEMP?` 之间的最小间隔（秒），范围 5–3600 |

没装 MT5700 Console（或它的服务没起来）时，ubus 查询失败，控制器退回旧缓存 /
兜底扫描；都拿不到就是"没读到"，模块温度不参与取热，**不会**因此触发故障保护。

## 安全说明

风扇控制属于设备安全功能。修改自定义曲线或手动 PWM 后应持续观察温度。控制器
只管理风扇 PWM，从不把整个 CPU thermal zone 切换到 `user_space`；无论是否
应用独占风扇补丁，都不应删除设备树中的 CPU 降频、hot 或 critical 保护。

## 许可证

[Apache License 2.0](LICENSE)
