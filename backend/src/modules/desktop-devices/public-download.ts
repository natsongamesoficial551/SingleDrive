import { Resolver } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Agent, fetch } from 'undici'
import { DavError } from './remote-disk-tree.js'

const excluded = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) excluded.addSubnet(address, prefix, 'ipv4')

const resolver = new Resolver({ timeout: 4000, tries: 2 })
export const publicAddress = (ip: string) => isIP(ip) === 4 && !excluded.check(ip, 'ipv4')

export function publicDownloadUrl(input: string) {
  let url: URL
  try { url = new URL(input) }
  catch { throw new DavError(400, 'Informe um link HTTP ou HTTPS válido.') }
  const host = url.hostname.replace(/\.$/, '')
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
    || isIP(host) || !/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')
    || /\.(localhost|local|internal|test|invalid|onion|lan|home\.arpa)$/i.test(host)) {
    throw new DavError(400, 'Use um link direto de um site público.')
  }
  return url
}

export async function openPublicDownload(input: string, signal: AbortSignal) {
  let url = publicDownloadUrl(input)
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted()
    const answers = await resolver.resolve4(url.hostname).catch(() => [])
    if (!answers.length || !answers.every(publicAddress)) throw new DavError(400, 'O link precisa apontar para um site público acessível.')
    // A conexão usa exatamente o endereço validado, com o hostname original para TLS.
    const dispatcher = new Agent({
      connect: { autoSelectFamily: false, family: 4, lookup: (_hostname, _options, callback) => callback(null, answers[0], 4) },
    })
    try {
      const response = await fetch(url, { dispatcher, signal, redirect: 'manual', headers: { 'Accept-Encoding': 'identity' } })
      const redirect = response.headers.get('location')
      if ([301, 302, 303, 307, 308].includes(response.status) && redirect) {
        await response.body?.cancel()
        await dispatcher.destroy()
        url = publicDownloadUrl(new URL(redirect, url).href)
        continue
      }
      const encoding = response.headers.get('content-encoding')
      if (response.status !== 200 || !response.body || (encoding && encoding.toLowerCase() !== 'identity')) {
        await response.body?.cancel()
        throw new DavError(422, 'O endereço não entregou um arquivo para download público.')
      }
      return { response, close: () => dispatcher.destroy() }
    } catch (error) {
      await dispatcher.destroy()
      throw error
    }
  }
  throw new DavError(422, 'O link redirecionou vezes demais.')
}
