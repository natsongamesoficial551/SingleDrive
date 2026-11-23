import { ArrowRight, Cloud, Download, Layers, Monitor, Play, ShieldCheck, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import './landing.css'

const installer = 'https://github.com/natsongamesoficial551/SingleDrive/releases/latest/download/SingleDrive-Windows-x64.msi'
const artwork = '/singledrive-landing.png'

export function LandingPage() {
  return <div className="sd-landing" id="inicio">
    <img className="sd-landing-reference" src={artwork} width="1024" height="1536" alt="" fetchPriority="high" />
    <header className="sd-landing-header">
      <nav className="sd-landing-nav" aria-label="Navegação principal">
        <a className="sd-landing-brand" href="#inicio"><i aria-hidden="true">S</i><span>SingleDrive</span></a>
        <a className="sd-landing-home" href="#inicio"><span>Início</span></a>
        <a className="sd-landing-nav-about" href="#sobre"><span>Sobre</span></a>
        <a className="sd-landing-nav-download" href="#download"><span>Download</span></a>
        <a className="sd-landing-nav-install" href={installer}><Download aria-hidden="true" /><span>Baixar Agora</span></a>
      </nav>
    </header>
    <main>
      <section className="sd-landing-hero" aria-labelledby="sd-landing-title">
        <div className="sd-landing-copy">
          <p className="sd-landing-tag">Unifique seus Google Drive</p>
          <h1 id="sd-landing-title">Todas as suas contas <em>Google Drive,</em> em um só lugar.</h1>
          <p className="sd-landing-description">Some o espaço de várias contas, acesse seus arquivos de qualquer lugar e use como um disco remoto direto no seu PC.</p>
        </div>
        <div className="sd-landing-actions">
          <a className="sd-landing-primary sd-landing-hero-install" href={installer}><Monitor aria-hidden="true" /><span>Baixar Agora</span><ArrowRight aria-hidden="true" /></a>
          <a className="sd-landing-secondary sd-landing-how" href="#sobre"><Play aria-hidden="true" /><span>Ver como funciona</span></a>
        </div>
        <ul className="sd-landing-highlights">
          <li><Zap aria-hidden="true" /> Mais espaço</li>
          <li><Cloud aria-hidden="true" /> Acesso remoto</li>
          <li><ShieldCheck aria-hidden="true" /> Seguro e confiável</li>
        </ul>
        <div className="sd-landing-art sd-landing-art-hero" aria-hidden="true" />
      </section>
      <section className="sd-landing-about" id="sobre" aria-labelledby="sd-landing-about-title">
        <div className="sd-landing-copy">
          <p className="sd-landing-tag">Sobre o SingleDrive</p>
          <h2 id="sd-landing-about-title">Mais espaço.<br /><em>Mais liberdade.</em></h2>
          <p className="sd-landing-description">O SingleDrive é a solução definitiva para unificar suas contas do Google Drive, somando o espaço de todas elas em uma única conta.</p>
          <ul className="sd-landing-features">
            <li><Layers aria-hidden="true" /> Some o espaço de várias contas</li>
            <li><Monitor aria-hidden="true" /> Use como disco remoto no PC</li>
            <li><Zap aria-hidden="true" /> Acesse seus arquivos de qualquer lugar</li>
          </ul>
        </div>
        <div className="sd-landing-art sd-landing-art-about" aria-hidden="true" />
      </section>
      <section className="sd-landing-download" id="download" aria-labelledby="sd-landing-download-title">
        <div className="sd-landing-copy">
          <p className="sd-landing-tag">Comece agora</p>
          <h2 id="sd-landing-download-title">Faça o download e comece a usar <em>em segundos.</em></h2>
          <p className="sd-landing-description">Disponível para Windows, com uma instalação simples e rápida. Aproveite todo o poder do SingleDrive no seu computador.</p>
        </div>
        <a className="sd-landing-primary sd-landing-final-install" href={installer}><Monitor aria-hidden="true" /><span>Baixar para Windows</span><ArrowRight aria-hidden="true" /></a>
        <p className="sd-landing-compatibility">Compatível com Windows 10 e 11</p>
        <Link className="sd-landing-open sd-landing-art" to="/login"><span className="sr-only">Acessar meus arquivos</span></Link>
      </section>
    </main>
  </div>
}
