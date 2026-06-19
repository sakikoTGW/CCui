import { parseCommandLine, parseCommand, CommandSchema, ErrorCode, ccuiError, toCcuiError } from '@ccui/protocol'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`) }
}

// 合法命令
const good = parseCommand({ cmd: 'send', text: 'hello', sessionId: 'main' })
ok('send 合法', good.ok === true && good.ok && good.command.cmd === 'send')

const orch = parseCommand({ cmd: 'orchestrate', prompt: 'x', lanes: [{ id: 'A' }] })
ok('orchestrate 合法', orch.ok === true)

// 缺必填
const bad = parseCommand({ cmd: 'send' })
ok('send 缺 text 报 BAD_COMMAND', bad.ok === false && bad.error.code === ErrorCode.BAD_COMMAND)

// 未知命令
const unknown = parseCommand({ cmd: 'nope' })
ok('未知命令报 BAD_COMMAND', unknown.ok === false && unknown.error.code === ErrorCode.BAD_COMMAND)

// 坏 JSON
const badjson = parseCommandLine('{ not json')
ok('坏 JSON 报 BAD_JSON', badjson.ok === false && badjson.error.code === ErrorCode.BAD_JSON)

// NDJSON 行
const line = parseCommandLine(JSON.stringify({ cmd: 'ping', reqId: 'r1' }))
ok('NDJSON ping 合法', line.ok === true)

// 错误工具
ok('ccuiError 形状', ccuiError(ErrorCode.TIMEOUT, 'x').code === 'TIMEOUT')
ok('toCcuiError 兜 Error', toCcuiError(new Error('boom')).message === 'boom')

// schema 命令数（防回归）
ok('命令枚举数 >= 18', CommandSchema.options.length >= 18)

console.log(`\nprotocol: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
