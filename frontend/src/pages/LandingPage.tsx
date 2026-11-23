import { ArrowRight, Check, ChevronRight, Cloud, Download, Folder, House, Info, Layers, Minus, Monitor, Play, Plus, Settings, ShieldCheck, Square, X, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import './landing.css'

const installerVersion = '0.5.0'
const installer = `https://github.com/natsongamesoficial551/SingleDrive/releases/download/v${installerVersion}/SingleDrive-${installerVersion}-x64.msi`

function Wordmark() {
  return <span className="sd-landing-wordmark"><span aria-hidden="true">S</span>SingleDrive</span>
}

function DriveMark() {
  return <span className="sd-drive-mark" aria-hidden="true"><i /><i /><i /></span>
}

function WindowsMark() {
  return <span className="sd-windows-mark" aria-hidden="true"><i /><i /><i /><i /></span>
}

function AppTitlebar() {
  return <div className="sd-demo-titlebar">
    <Wordmark />
    <span aria-hidden="true"><Minus /><Square /><X /></span>
  </div>
}

function LaptopPreview() {
  return <div className="sd-laptop-preview" aria-hidden="true">
    <span className="sd-floating-drive"><DriveMark /></span>
    <span className="sd-floating-drive"><DriveMark /></span>
    <span className="sd-floating-drive"><DriveMark /></span>
    <div className="sd-laptop">
      <div className="sd-laptop-screen">
        <div className="sd-laptop-display">
          <AppTitlebar />
          <div className="sd-laptop-dashboard">
            <div className="sd-laptop-quota">
              <span className="sd-demo-orbit"><DriveMark /><Check /></span>
              <strong>15,2 TB</strong>
              <small>Total unificado</small>
            </div>
            <ul className="sd-laptop-accounts">
              {['seuemail', 'conta2', 'conta3'].map(account => <li key={account}>
                <GoogleLogo /><span>{account}@gmail.com</span><ChevronRight />
              </li>)}
              <li><Plus /><span>Adicionar conta</span></li>
            </ul>
            <div className="sd-demo-progress"><span /><b>78%</b></div>
          </div>
        </div>
      </div>
      <div className="sd-laptop-base"><span /></div>
    </div>
  </div>
}

function AccountsPreview() {
  return <div className="sd-account-preview" aria-hidden="true">
    <ul>
      {['pessoal', 'trabalho', 'estudos'].map(account => <li key={account}>
        <DriveMark /><span>{account}@gmail.com</span><strong>2 TB</strong>
      </li>)}
    </ul>
    <div className="sd-account-connector"><i /><i /><i /></div>
    <div className="sd-account-total"><DriveMark /><strong>6 TB</strong><span>Total disponível</span></div>
  </div>
}

function DesktopPreview() {
  return <div className="sd-desktop-preview">
    <div className="sd-demo-window">
      <div aria-hidden="true"><AppTitlebar /></div>
      <div className="sd-demo-window-body">
        <ul aria-hidden="true">
          <li><House /> Início</li>
          <li><Folder /> Arquivos</li>
          <li><Settings /> Configurações</li>
          <li><Info /> Sobre</li>
        </ul>
        <div className="sd-demo-window-main">
          <div aria-hidden="true">
            <span className="sd-demo-orbit"><Check /></span>
            <strong>Tudo pronto!</strong>
            <p>Suas contas estão conectadas.</p>
          </div>
          <Link className="sd-landing-open" to="/login">Acessar meus arquivos</Link>
        </div>
      </div>
    </div>
    <span className="sd-floating-windows"><WindowsMark /></span>
  </div>
}

export function LandingPage() {
  return <div className="sd-landing" id="inicio">
    <header className="sd-landing-header">
      <nav className="sd-landing-shell sd-landing-nav" aria-label="Navegação principal">
        <a className="sd-landing-brand" href="#inicio"><Wordmark /></a>
        <div className="sd-landing-nav-links">
          <a href="#inicio">Início</a>
          <a href="#sobre">Sobre</a>
          <a href="#download">Download</a>
        </div>
        <div className="sd-landing-nav-actions">
          <Link className="sd-landing-nav-login" to="/login">Entrar</Link>
          <a className="sd-landing-nav-install" href={installer} aria-label="Baixar Agora"><Download aria-hidden="true" /><span>Baixar Agora</span></a>
        </div>
      </nav>
    </header>
    <main>
      <section className="sd-landing-hero" aria-labelledby="sd-landing-title">
        <div className="sd-landing-ribbon" aria-hidden="true" />
        <div className="sd-landing-shell sd-landing-split">
          <div className="sd-landing-copy">
            <p className="sd-landing-tag">Unifique suas contas Google Drive</p>
            <h1 id="sd-landing-title">Todas as suas contas <em>Google Drive,</em> em um só lugar.</h1>
            <p className="sd-landing-description">Some o espaço de várias contas, acesse seus arquivos de qualquer lugar e use como um disco remoto direto no seu PC.</p>
            <div className="sd-landing-actions">
              <a className="sd-landing-primary" href={installer}><WindowsMark /> Baixar Agora <ArrowRight aria-hidden="true" /></a>
              <a className="sd-landing-secondary" href="#sobre"><span><Play aria-hidden="true" /></span> Ver como funciona</a>
            </div>
            <ul className="sd-landing-highlights">
              <li><Zap aria-hidden="true" /> Mais espaço</li>
              <li><Cloud aria-hidden="true" /> Acesso remoto</li>
              <li><ShieldCheck aria-hidden="true" /> Seguro e confiável</li>
            </ul>
          </div>
          <LaptopPreview />
        </div>
      </section>
      <section className="sd-landing-about" id="sobre" aria-labelledby="sd-landing-about-title">
        <div className="sd-landing-shell sd-landing-split">
          <div className="sd-landing-copy">
            <p className="sd-landing-tag">Sobre o SingleDrive</p>
            <h2 id="sd-landing-about-title">Mais espaço.<br /><em>Mais liberdade.</em></h2>
            <p className="sd-landing-description">Unifique suas contas do Google Drive e gerencie o espaço de todas elas pelo SingleDrive.</p>
            <ul className="sd-landing-features">
              <li><Layers aria-hidden="true" /> Some o espaço de várias contas</li>
              <li><Monitor aria-hidden="true" /> Use como disco remoto no PC</li>
              <li><Zap aria-hidden="true" /> Acesse seus arquivos de qualquer lugar</li>
            </ul>
          </div>
          <AccountsPreview />
        </div>
      </section>
      <section className="sd-landing-download" id="download" aria-labelledby="sd-landing-download-title">
        <div className="sd-landing-ribbon" aria-hidden="true" />
        <div className="sd-landing-shell sd-landing-split">
          <div className="sd-landing-copy">
            <p className="sd-landing-tag">Comece agora</p>
            <h2 id="sd-landing-download-title">Faça o download e comece a usar <em>em segundos.</em></h2>
            <p className="sd-landing-description">Instale o SingleDrive para Windows e acesse seus arquivos da nuvem direto no computador.</p>
            <a className="sd-landing-primary" href={installer}><WindowsMark /> Baixar para Windows <ArrowRight aria-hidden="true" /></a>
            <p className="sd-landing-compatibility">Versão {installerVersion} · MSI para Windows 10 e 11, 64 bits</p>
          </div>
          <DesktopPreview />
        </div>
      </section>
    </main>
  </div>
}
