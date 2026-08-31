'use strict';

// 平台分派层：按运行平台选择原生实现。
// Windows：native.js（user32/kernel32，剪贴板序列号 + 前台进程名齐全）
// macOS  ：nativeDarwin.js（CoreGraphics 注入 Cmd+C）
// Linux  ：nativeLinux.js（XTest 注入 Ctrl+C）
// 其他平台：空实现（保证应用能启动，功能受限但不会崩）。

let impl = null;

function getImpl() {
  if (impl) return impl;
  switch (process.platform) {
    case 'win32':
      impl = require('#lib/native.js');
      break;
    case 'darwin':
      impl = require('#lib/nativeDarwin.js');
      break;
    case 'linux':
      impl = require('#lib/nativeLinux.js');
      break;
    default:
      impl = {
        sendCtrlC() {},
        clipboardSequence() {
          return null;
        },
        getForegroundProcessName() {
          return null;
        }
      };
  }
  return impl;
}

module.exports = {
  sendCtrlC() {
    return getImpl().sendCtrlC();
  },
  clipboardSequence() {
    return getImpl().clipboardSequence();
  },
  getForegroundProcessName() {
    return getImpl().getForegroundProcessName();
  }
};