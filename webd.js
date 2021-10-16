#!/usr/bin/env node
// HTTP super-server, sort of like inetd but for web services only.

if (process.argv.length < 3) {
	console.error(`Usage: ./webd.js ./config`)
	process.exit(1)
}
const config = require(process.argv[2])

const http = require('http')
const child_process = require('child_process')

const sleep = (millis) => new Promise(resolve => setTimeout(resolve, millis))

const connectionOptions = host => ({
	host: 'localhost',
	protocol: 'http:',
	...config.backends[host].connectionOptions,
})

const isUp = (host) => new Promise((resolve, reject) => {
	// Try to establish a connection to the backend
	// (just TCP, not sending requests)
	const sock = http.globalAgent.createConnection(connectionOptions(host))
	// If we get an error while connecting, report it
	const errHandler = (err) => resolve(false)
	sock.on('error', errHandler)
	// Once we're connected, drop the error handler and report success:
	// the backend is accepting connections, which is all we care about now.
	sock.on('connect', () => {
		sock.off('error', errHandler)
		sock.end(err => {
			if (err) {
				errHandler(err)
			} else {
				resolve(true)
			}
		})
	})
})

const forwardHttpRequest = (host, ireq, ires) => new Promise((resolve, reject) => {
	// Wire together ireq -> oreq -> ores -> ires
	const oreq = http.request({
		method: ireq.method,
		path: ireq.url,
		headers: ireq.headers,
		...connectionOptions(host),
		setHost: false,
	})
	oreq.once('error', err => reject(err))
	oreq.once('response', ores => {
		ires.writeHead(ores.statusCode, ores.statusMessage, ores.rawHeaders)
		ores.pipe(ires, {end: true})
		resolve()
	})
	ireq.pipe(oreq, {end: true})
})

const backends = {}

const spawnBackend = host => new Promise((resolve, reject) => {
	const backendConfig = config.backends[host]
	const child = child_process.spawn(backendConfig.run.command, backendConfig.run.args, {
		detached: true,
		stdio: ['ignore', 1, 2],
		shell: backendConfig.run.shell,
		cwd: backendConfig.run.cwd,
	})
	const errorHandler = err => reject(err)
	child.once('error', errorHandler)
	child.once('spawn', () => {
		child.off('error', errorHandler)
		resolve(child)
	})
})

async function setupBackend(host) {
	const backendConfig = config.backends[host]
	if (!backendConfig) {
		throw new Error(`Unknown host: ${host}`)
	}
	
	let shutdown = () => {}
	
	try {
		// Boot backend, but only if it's not already listening by some other means
		if (backendConfig.run && !await isUp(host)) {
			const child = await spawnBackend(host)
			let running = true
			shutdown = () => new Promise((resolve, reject) => {
				delete backends[host]
				if (!running) return // Already fell over, don't try to kill
				process.kill(-child.pid) // Kill entire process group
				child.once('exit', resolve())
				child.once('error', reject())
			})
			child.on('exit', (code, signal) => {
				console.error(`backend for ${host} exited with status ${code} due to signal ${signal}`)
				running = false
				delete backends[host]
			})
			while (running) {
				if (await isUp(host)) break
				await sleep(50) // Pause for 50ms between retries
			}
			if (!running) {
				throw new Error('Backend failed while starting')
			}
		}
	} catch (e) {
		delete backends[host]
		shutdown()
		throw e
	}
	
	let renew = () => {}
	if (backendConfig.shutdownAfter) {
		let tmrHandle
		renew = () => {
			clearTimeout(tmrHandle)
			tmrHandle = setTimeout(shutdown, backendConfig.shutdownAfter)
		}
		renew()
	}
	
	return {
		forward: async (ireq, ires) => {
			renew()
			await forwardHttpRequest(host, ireq, ires)
		},
		shutdown,
	}
}

function getBackend(host) {
	if (!backends[host]) {
		backends[host] = setupBackend(host)
	}
	return backends[host]
}

const server = http.createServer(async (req, res) => {
	try {
		const host = req.headers['host']
		if (config.indexHost && host === config.indexHost) {
			if (req.method !== 'GET') {
				res.writeHead(405, 'Method Not Allowed')
				res.end('405 Method Not Allowed')
			} else if (req.url !== '/') {
				res.writeHead(404, 'Not Found')
				res.end('404 Not Found')
			} else { // GET /
				res.writeHead(200, 'OK', ['Content-Type', 'text/html'])
				const esc = s => s.replace(/&/g, '&amp;')
					.replace(/"/g, '&quot;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				res.end(
					`<!DOCTYPE html><title>${esc(host)}</title><h1>${esc(host)}</h1>` +
					'<ul>'+Object.keys(config.backends).map(k =>
						`<li><a href="http://${esc(k)}">${esc(k)}</a>`
					).join('') + '</ul>'
				)
			}
		} else {
			const backend = await getBackend(host)
			await backend.forward(req, res)
		}
	} catch (e) {
		if (!res.headersSent) {
			res.writeHead(500, ['content-type', 'text/plain'])
		}
		res.write('webd error: ')
		res.end(e.message)
	}
})
server.listen(config.listen)

async function shutdown() {
	console.log('Shutting down...')
	await new Promise(resolve => server.close(resolve))
	await Promise.all(Object.values(backends).map(bp => bp.then(b => b.shutdown())))
	process.exit()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
