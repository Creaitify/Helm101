import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface AgentRunResult {
  ok: boolean
  runId?: string
  status?: string
  isAwaitingApproval?: boolean
  interruptPayload?: Record<string, any> | null
  state?: Record<string, any>
  error?: string
}

export interface PendingApprovalItem {
  runId: string
  status: string
  isAwaitingApproval: boolean
  interruptPayload?: Record<string, any> | null
  state?: Record<string, any>
}


function resolvePythonBinary(): { bin: string; cwd: string } {
  const cwdCandidate1 = path.join(process.cwd(), 'workers')
  const cwdCandidate2 = path.join(path.resolve(process.cwd(), '..'), 'workers')
  const workersDir = fs.existsSync(cwdCandidate1) ? cwdCandidate1 : cwdCandidate2

  const winPy = path.join(workersDir, '.venv', 'Scripts', 'python.exe')
  const unixPy = path.join(workersDir, '.venv', 'bin', 'python')

  let bin = process.platform === 'win32' ? winPy : unixPy

  if (process.platform === 'win32') {
    const cfgPath = path.join(workersDir, '.venv', 'pyvenv.cfg')
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = fs.readFileSync(cfgPath, 'utf-8')
        const m = cfg.match(/executable\s*=\s*(.+)/)
        if (m && m[1] && fs.existsSync(m[1].trim())) {
          bin = m[1].trim()
        }
      } catch {}
    }
  }

  return {
    bin,
    cwd: workersDir,
  }
}

async function runWorkerCommand(args: string[]): Promise<string> {
  const { bin, cwd } = resolvePythonBinary()

  return new Promise((resolve, reject) => {
    const fullArgs = ['-m', 'helm_worker', ...args, '--json']
    
    const sitePackages = path.join(cwd, '.venv', 'Lib', 'site-packages')
    const workerEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      VIRTUAL_ENV: path.join(cwd, '.venv'),
      PYTHONPATH: `${cwd};${sitePackages}` + (process.env.PYTHONPATH ? `;${process.env.PYTHONPATH}` : ''),
      PATH: path.join(cwd, '.venv', 'Scripts') + ';' + (process.env.PATH || ''),
      SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows',
      LOCALAPPDATA: process.env.LOCALAPPDATA || '',
      APPDATA: process.env.APPDATA || '',
      USERPROFILE: process.env.USERPROFILE || '',
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      HELM_API_BASE_URL: process.env.HELM_API_BASE_URL || 'http://localhost:8000',
    }
    delete workerEnv.ANTHROPIC_API_KEY
    delete workerEnv.OPENAI_API_KEY
    delete workerEnv.GOOGLE_API_KEY
    delete workerEnv.GEMINI_API_KEY
    delete workerEnv.DATABASE_URL

    const proc = spawn(bin, fullArgs, {
      cwd,
      env: workerEnv,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8')
    })

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8')
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `Worker exited with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

function parseStructuredOutput(output: string): Record<string, any> | null {
  const lines = output.split('\n').filter((l) => l.trim().startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if ('status' in parsed || 'is_awaiting_approval' in parsed || 'state' in parsed) {
        return parsed
      }
    } catch {}
  }
  if (lines.length > 0) {
    try {
      return JSON.parse(lines[lines.length - 1])
    } catch {}
  }
  return null
}

/**
 * Start an agent run in the durable LangGraph worker runtime.
 */
export async function startAgentRun(
  agent: 'governor' | 'media_buyer' | 'creative' | 'analyst',
  input: string,
): Promise<AgentRunResult> {
  try {
    let args: string[] = []
    if (agent === 'analyst') {
      args = ['ask', input]
    } else if (agent === 'media_buyer') {
      args = ['buy', '--objective', input]
    } else if (agent === 'creative') {
      args = ['create', input]
    } else if (agent === 'governor') {
      args = ['govern', input]
    } else {
      return { ok: false, error: `Unknown agent task: ${agent}` }
    }

    const output = await runWorkerCommand(args)
    const parsed = parseStructuredOutput(output)
    if (!parsed) {
      return { ok: false, error: 'No structured response from worker' }
    }

    return {
      ok: true,
      runId: parsed.run_id,
      status: parsed.status,
      isAwaitingApproval: parsed.is_awaiting_approval,
      interruptPayload: parsed.interrupt_payload,
      state: parsed.state,
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Worker execution failed' }
  }
}

/**
 * Supply a human decision (approve/reject) to resume a paused agent run.
 */
export async function decideAgentRun(
  runId: string,
  decision: 'approved' | 'rejected',
  reason: string = '',
): Promise<AgentRunResult> {
  try {
    const args = ['decide', runId, decision === 'approved' ? '--approve' : '--reject']
    if (reason) {
      args.push('--reason', reason)
    }

    const output = await runWorkerCommand(args)
    const parsed = parseStructuredOutput(output)
    if (!parsed) {
      return { ok: false, error: 'No structured response from worker' }
    }

    return {
      ok: true,
      runId: parsed.run_id,
      status: parsed.status,
      isAwaitingApproval: parsed.is_awaiting_approval,
      interruptPayload: parsed.interrupt_payload,
      state: parsed.state,
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Decision failed' }
  }
}

/**
 * Inspect the current state of any run by its ID.
 */
export async function getAgentRunStatus(runId: string): Promise<AgentRunResult> {
  try {
    const output = await runWorkerCommand(['status', runId])
    const parsed = parseStructuredOutput(output)
    if (!parsed) {
      return { ok: false, error: 'No structured response from worker' }
    }

    return {
      ok: true,
      runId: parsed.run_id,
      status: parsed.status,
      isAwaitingApproval: parsed.is_awaiting_approval,
      interruptPayload: parsed.interrupt_payload,
      state: parsed.state,
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Run lookup failed' }
  }
}

/**
 * List all active runs waiting for human decisions.
 */
export async function listPendingApprovals(): Promise<PendingApprovalItem[]> {
  try {
    const output = await runWorkerCommand(['pending'])
    const lines = output.split('\n').filter((l) => l.trim().startsWith('['))
    const jsonStr = lines[lines.length - 1]
    if (!jsonStr) return []

    const list = JSON.parse(jsonStr)
    return list.map((item: any) => ({
      runId: item.run_id,
      status: item.status,
      isAwaitingApproval: item.is_awaiting_approval,
      interruptPayload: item.interrupt_payload,
      state: item.state,
    }))
  } catch {
    return []
  }
}
