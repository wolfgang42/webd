#!/usr/bin/env node
// HTTP super-server, sort of like inetd but for web services only.

if (process.argv.length < 3) {
	console.error(`Usage: ./webd.js ./config`)
	process.exit(1)
}
const config = require(process.argv[2])

const http = require('http')

const connectionOptions = host => ({
	host: 'localhost',
	protocol: 'http:',
	...config.backends[host].connectionOptions,
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

async function setupBackend(host) {
	const backendConfig = config.backends[host]
	if (!backendConfig) {
		throw new Error(`Unknown host: ${host}`)
	}
	
	return {
		forward: async (ireq, ires) => {
			await forwardHttpRequest(host, ireq, ires)
		},
	}
}

const backends = {}

function getBackend(host) {
	if (!backends[host]) {
		backends[host] = setupBackend(host)
	}
	return backends[host]
}

const server = http.createServer(async (req, res) => {
	try {
		const host = req.headers['host']
		const backend = await getBackend(host)
		await backend.forward(req, res)
	} catch (e) {
		if (!res.headersSent) {
			res.writeHead(500, ['content-type', 'text/plain'])
		}
		res.write('webd error: ')
		res.end(e.message)
	}
})
server.listen(config.listen)
