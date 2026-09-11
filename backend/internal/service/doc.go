package service

// 本包是 HTTP 组合根的稳定导入路径。业务实现在 internal/app，
// 这里只再导出类型、常量和包级函数，避免 handler/cmd 改 import。
