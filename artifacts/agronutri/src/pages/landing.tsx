import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useReveal } from "@/hooks/use-reveal";
import heroImage from "@assets/generated_images/hero-atlantic-plantation.jpg";
import ctaImage from "@assets/generated_images/cta-banana-leaves.jpg";
import technicianImage from "@assets/generated_images/technician-silhouette.jpg";
import {
  Bot,
  Calculator,
  TestTube,
  SprayCan,
  FileText,
  Smartphone,
  ShieldCheck,
  Droplets,
  Leaf,
  LineChart,
  Users,
  CheckCircle2,
  ArrowRight,
  ArrowDown,
  Fingerprint,
  FlaskConical,
  Menu,
  X,
  Quote,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const img = (name: string) => `${BASE}landing/${name}`;

function BrowserFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(8,30,20,0.45)] ring-1 ring-black/10 bg-white ${className}`}>
      <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#e9e2d3] border-b border-black/10">
        <span className="w-3 h-3 rounded-full bg-[#e08a5b]" />
        <span className="w-3 h-3 rounded-full bg-[#d9b45c]" />
        <span className="w-3 h-3 rounded-full bg-[#5c8a63]" />
        <div className="ml-3 flex-1 max-w-xs h-5 rounded bg-white/70 border border-black/5" />
      </div>
      <img src={src} alt={alt} loading="lazy" className="w-full block" />
    </div>
  );
}

function PhoneFrame({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[2.2rem] border-[10px] border-[#0c1f16] bg-[#0c1f16] shadow-[0_30px_70px_-15px_rgba(8,30,20,0.55)] overflow-hidden ${className}`}>
      <img src={src} alt={alt} loading="lazy" className="w-full block rounded-[1.6rem]" />
    </div>
  );
}

const features = [
  {
    icon: TestTube,
    title: "Analíticas centralizadas",
    text: "Suelo, foliar y agua en un solo lugar, por finca o por sector. Sube el PDF del laboratorio y la IA extrae los parámetros por ti.",
  },
  {
    icon: Calculator,
    title: "Calculadora de fertirrigación",
    text: "Plan de abonado semanal con estimación de CE, nutrientes aportados y avisos de incompatibilidad entre productos.",
  },
  {
    icon: Bot,
    title: "Técnico virtual con IA",
    text: "Programas de abonado generados a partir de tus analíticas y un chat agronómico que conoce tu finca, con fotos y documentos.",
  },
  {
    icon: Droplets,
    title: "Acidificación del agua",
    text: "Si usas ácido para bajar el pH de riego, la IA calcula los litros semanales necesarios a partir del pH y los bicarbonatos.",
  },
  {
    icon: SprayCan,
    title: "Sanidad vegetal",
    text: "Catálogo de fitosanitarios con registro, materia activa y plazos de seguridad. Registra cada aplicación por sector.",
  },
  {
    icon: FileText,
    title: "Informes profesionales",
    text: "Informes técnicos en PDF y Word con tus datos, analíticas y programa, con resumen redactado por IA y tu logo.",
  },
  {
    icon: Users,
    title: "Equipo y roles",
    text: "Propietarios, técnicos y colaboradores con permisos por finca, auditoría de acciones y gestión de usuarios.",
  },
  {
    icon: ShieldCheck,
    title: "Tus datos, en tu servidor",
    text: "Instálalo en tu propia infraestructura con un solo comando: HTTPS automático, copias de seguridad y actualizaciones sencillas.",
  },
];

const steps = [
  { n: "01", title: "Sube tus analíticas", text: "Agua, suelo y foliar: a mano o importando el PDF del laboratorio con IA." },
  { n: "02", title: "Genera tu programa", text: "El técnico virtual propone un plan de abonado semanal adaptado a tu finca o sector." },
  { n: "03", title: "Aplica y controla", text: "Valida el programa, registra fitosanitarios y entrega informes profesionales." },
];

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 bg-[#eaf4ec] ${
        scrolled ? "bg-[#eaf4ec]/95 backdrop-blur-md shadow-md" : ""
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 h-[68px] flex items-center justify-between">
        <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-8" />
        <nav className="hidden md:flex items-center gap-8">
          <a href="#funciones" className="text-sm font-medium text-[#12402d]/75 hover:text-[#12402d] transition-colors">
            Funcionalidades
          </a>
          <a href="#precios" className="text-sm font-medium text-[#12402d]/75 hover:text-[#12402d] transition-colors">
            Precios
          </a>
          <Link href="/terminos" className="text-sm font-medium text-[#12402d]/75 hover:text-[#12402d] transition-colors">
            Términos
          </Link>
        </nav>
        <div className="hidden md:flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" className="text-[#12402d] hover:text-[#12402d] hover:bg-[#12402d]/5" data-testid="button-landing-login">
              Entrar
            </Button>
          </Link>
          <Link href="/login">
            <Button className="bg-[#2f9e68] hover:bg-[#258355] text-white font-semibold" data-testid="button-landing-cta-top">
              Empezar ahora <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
        <button
          className="md:hidden text-[#12402d] p-2"
          onClick={() => setOpen((v) => !v)}
          data-testid="button-mobile-menu-toggle"
          aria-label="Abrir menú"
        >
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      {open && (
        <div className="md:hidden bg-[#eaf4ec] border-t border-[#12402d]/10 px-5 py-6 flex flex-col gap-4">
          <a href="#funciones" onClick={() => setOpen(false)} className="text-[#12402d]/90 font-medium">
            Funcionalidades
          </a>
          <a href="#precios" onClick={() => setOpen(false)} className="text-[#12402d]/90 font-medium">
            Precios
          </a>
          <Link href="/terminos" onClick={() => setOpen(false)} className="text-[#12402d]/90 font-medium">
            Términos
          </Link>
          <div className="flex flex-col gap-2 pt-2">
            <Link href="/login">
              <Button variant="outline" className="w-full border-[#12402d]/30 text-[#12402d] bg-transparent hover:bg-[#12402d]/5" data-testid="button-landing-login-mobile">
                Entrar
              </Button>
            </Link>
            <Link href="/login">
              <Button className="w-full bg-[#2f9e68] hover:bg-[#258355] text-white font-semibold" data-testid="button-landing-cta-top-mobile">
                Empezar ahora
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id={id} ref={ref} className={className}>
      {children}
    </section>
  );
}

function Hero() {
  const heroRef = useReveal<HTMLElement>();
  useEffect(() => {
    // Hero content is above the fold on load — force-trigger reveal immediately
    // in case it enters the viewport before the observer attaches.
    const el = heroRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.querySelectorAll<HTMLElement>(".reveal").forEach((node, i) => {
        node.style.transitionDelay = `${i * 90}ms`;
        node.classList.add("is-visible");
      });
    });
    return () => cancelAnimationFrame(id);
  }, [heroRef]);

  return (
    <section ref={heroRef} className="relative min-h-[100dvh] flex flex-col justify-center overflow-hidden bg-[#0c1f16]">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Plantación de plátanos en Canarias al atardecer"
            className="w-full h-full object-cover opacity-85 saturate-110"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0c1f16]/45 via-[#0c1f16]/30 to-[#0c1f16]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c1f16] via-transparent to-transparent" />
        </div>

        <div className="relative max-w-6xl mx-auto px-5 pt-28 pb-16 text-center w-full">
          <span
            className="reveal inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.18em] uppercase text-[#6fd39f] bg-[#6fd39f]/10 ring-1 ring-[#6fd39f]/30 rounded-full px-4 py-2 mb-8"
          >
            <Leaf className="w-3.5 h-3.5" /> Fertirrigación inteligente para platanera
          </span>
          <h1 className="reveal font-display text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02] text-[#f4ead9]" data-reveal-delay="80">
            Tu técnico virtual,
            <br />
            <span className="italic text-[#6fd39f]">a pie de finca.</span>
          </h1>
          <p className="reveal mt-8 text-lg md:text-xl text-[#f4ead9]/75 max-w-2xl mx-auto leading-relaxed" data-reveal-delay="160">
            AgroNutri AI convierte tus analíticas de suelo, foliar y agua en programas de abonado
            precisos, con inteligencia artificial, calculadora de fertirrigación e informes
            profesionales. Desde el ordenador o desde el móvil, en plena finca.
          </p>
          <div className="reveal mt-10 flex flex-wrap justify-center gap-4" data-reveal-delay="240">
            <Link href="/login">
              <Button
                size="lg"
                className="bg-[#2f9e68] hover:bg-[#258355] text-white font-semibold text-base h-13 px-8 shadow-[0_10px_30px_-8px_rgba(47,158,104,0.6)] hover:shadow-[0_15px_40px_-8px_rgba(47,158,104,0.7)] transition-all hover:-translate-y-0.5"
                data-testid="button-landing-cta-hero"
              >
                Probar AgroNutri AI <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a href="#funciones">
              <Button
                size="lg"
                variant="outline"
                className="text-base h-13 px-8 border-[#f4ead9]/30 text-[#f4ead9] bg-white/5 hover:bg-white/10 hover:text-[#f4ead9]"
              >
                Ver funcionalidades
              </Button>
            </a>
          </div>
          <div className="reveal mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-[#f4ead9]/60" data-reveal-delay="320">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-[#6fd39f]" /> Instalación en tu propio servidor</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-[#6fd39f]" /> Web + app móvil</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-[#6fd39f]" /> IA con tu propia clave</span>
          </div>
        </div>

        <div className="relative flex justify-center pb-8">
          <ArrowDown className="w-5 h-5 text-[#f4ead9]/40 animate-float-slow" />
        </div>
      </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] font-sans overflow-x-hidden">
      <div className="grain-overlay" />
      <NavBar />

      <Hero />

      {/* Hero visual — screenshots emerging from the dark hero into light */}
      <div className="relative bg-gradient-to-b from-[#0c1f16] to-[hsl(var(--background))] pb-24 pt-4 -mt-1">
        <Section className="max-w-6xl mx-auto px-5">
          <div className="relative reveal-scale">
            <BrowserFrame src={img("web-finca.png")} alt="Panel de finca de AgroNutri AI" className="md:mx-10" />
            <PhoneFrame
              src={img("movil-finca.png")}
              alt="Ficha de finca en la app móvil"
              className="hidden md:block absolute -bottom-12 -right-2 w-52 rotate-3"
            />
          </div>
        </Section>
      </div>

      {/* Value strip */}
      <Section className="bg-[#0c1f16] text-[#f4ead9] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_20%,#2f9e68,transparent_45%)]" />
        <div className="relative max-w-6xl mx-auto px-5 py-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            ["Analíticas", "suelo · foliar · agua"],
            ["Programas IA", "por finca o por sector"],
            ["Fitosanitarios", "plazos y aplicaciones"],
            ["Informes", "PDF y Word con tu logo"],
          ].map(([t, s], i) => (
            <div key={t} className="reveal" data-reveal-delay={i * 90}>
              <div className="font-display text-2xl font-semibold text-[#6fd39f]">{t}</div>
              <div className="text-sm text-[#f4ead9]/55 mt-1 font-mono-label tracking-wide">{s}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section className="max-w-6xl mx-auto px-5 py-28">
        <div className="text-center reveal">
          <span className="text-xs font-mono-label tracking-[0.2em] uppercase text-[hsl(var(--secondary))]">Metodología</span>
          <h2 className="mt-3 font-display text-3xl md:text-5xl font-semibold tracking-tight">Del laboratorio al goteo en tres pasos</h2>
        </div>
        <div className="mt-16 grid md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="reveal relative rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-9 hover:-translate-y-1.5 transition-transform duration-300"
              data-reveal-delay={i * 120}
            >
              <div className="font-display text-5xl font-semibold text-[hsl(var(--secondary))]/25">{s.n}</div>
              <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
              <p className="mt-3 text-[hsl(var(--muted-foreground))] leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Screenshot: dashboard */}
      <Section className="bg-[hsl(var(--muted))]/50 border-y border-[hsl(var(--border))]">
        <div className="max-w-6xl mx-auto px-5 py-28 grid md:grid-cols-2 gap-14 items-center">
          <div className="reveal-left">
            <span className="inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.15em] uppercase text-[hsl(var(--primary))]"><LineChart className="w-4 h-4" /> Visión global</span>
            <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight">Toda tu explotación de un vistazo</h2>
            <p className="mt-5 text-[hsl(var(--muted-foreground))] text-lg leading-relaxed">
              Fincas, plantas en producción, recomendaciones pendientes, coste de IA del mes,
              actividad reciente y alertas agronómicas: renueva analíticas a tiempo y vigila el
              sodio, la CE o los plazos de seguridad sin hojas de cálculo.
            </p>
            <ul className="mt-7 space-y-3 text-[hsl(var(--foreground))]">
              {["Alertas automáticas por finca", "Actividad y auditoría del equipo", "Control del gasto en IA"].map((t) => (
                <li key={t} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-[hsl(var(--secondary))] shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="reveal-right"><BrowserFrame src={img("web-dashboard.png")} alt="Dashboard general" /></div>
        </div>
      </Section>

      {/* Screenshot: analiticas */}
      <Section className="max-w-6xl mx-auto px-5 py-28 grid md:grid-cols-2 gap-14 items-center">
        <div className="order-last md:order-first reveal-left"><BrowserFrame src={img("web-analiticas.png")} alt="Analíticas de la finca" /></div>
        <div className="reveal-right">
          <span className="inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.15em] uppercase text-[hsl(var(--primary))]"><FlaskConical className="w-4 h-4" /> Analíticas</span>
          <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight">Tus analíticas trabajan por ti</h2>
          <p className="mt-5 text-[hsl(var(--muted-foreground))] text-lg leading-relaxed">
            Registra analíticas de suelo, foliar y agua por finca o por sector, o importa
            directamente el PDF del laboratorio: la IA extrae los parámetros y los deja listos
            para el cálculo.
          </p>
          <ul className="mt-7 space-y-3 text-[hsl(var(--foreground))]">
            {["Importación de PDF con IA", "Ámbito global o por sector", "Histórico completo por tipo"].map((t) => (
              <li key={t} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-[hsl(var(--secondary))] shrink-0" /> {t}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Screenshot: calculadora */}
      <Section className="bg-[hsl(var(--muted))]/50 border-y border-[hsl(var(--border))]">
        <div className="max-w-6xl mx-auto px-5 py-28 grid md:grid-cols-2 gap-14 items-center">
          <div className="reveal-left">
            <span className="inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.15em] uppercase text-[hsl(var(--primary))]"><Bot className="w-4 h-4" /> IA agronómica</span>
            <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight">Programas de abonado con inteligencia artificial</h2>
            <p className="mt-5 text-[hsl(var(--muted-foreground))] text-lg leading-relaxed">
              Pulsa «Generar con IA» y obtén un borrador de programa semanal basado en tus últimas
              analíticas, tu catálogo de fertilizantes y las condiciones de tu finca. Ajusta,
              valida y aplícalo con seguimiento de estados.
            </p>
            <ul className="mt-7 space-y-3 text-[hsl(var(--foreground))]">
              {[
                "Por finca completa o sector a sector",
                "Cálculo de litros de ácido para corregir el pH del agua",
                "CE estimada y avisos de incompatibilidad",
                "Chat con el técnico virtual, con fotos y adjuntos",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-[hsl(var(--secondary))] shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="reveal-right"><BrowserFrame src={img("web-calculadora.png")} alt="Calculadora de fertirrigación con IA" /></div>
        </div>
      </Section>

      {/* Screenshot: fitosanitarios */}
      <Section className="max-w-6xl mx-auto px-5 py-28 grid md:grid-cols-2 gap-14 items-center">
        <div className="order-last md:order-first reveal-left"><BrowserFrame src={img("web-fitosanitarios.png")} alt="Catálogo de fitosanitarios" /></div>
        <div className="reveal-right">
          <span className="inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.15em] uppercase text-[hsl(var(--primary))]"><SprayCan className="w-4 h-4" /> Sanidad vegetal</span>
          <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight">Fitosanitarios bajo control</h2>
          <p className="mt-5 text-[hsl(var(--muted-foreground))] text-lg leading-relaxed">
            Catálogo con número de registro, materia activa, plaga objetivo y plazos de seguridad,
            con fichas actualizables por IA. Registra cada aplicación por sector y recibe avisos
            de productos con registro caducado.
          </p>
          <ul className="mt-7 space-y-3 text-[hsl(var(--foreground))]">
            {["Fichas actualizadas con IA", "Registro de aplicaciones por sector", "Avisos de caducidad de registro"].map((t) => (
              <li key={t} className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-[hsl(var(--secondary))] shrink-0" /> {t}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Testimonial-style quote strip with silhouette photo */}
      <Section className="relative bg-[#0c1f16] text-[#f4ead9] overflow-hidden">
        <img src={technicianImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0c1f16] via-[#0c1f16]/85 to-[#0c1f16]/40" />
        <div className="relative max-w-4xl mx-auto px-5 py-28 reveal-scale">
          <Quote className="w-10 h-10 text-[#6fd39f] mb-6" />
          <p className="font-display text-2xl md:text-4xl font-medium leading-snug">
            "Antes tardábamos días en cruzar analíticas de veinte fincas. Ahora el técnico virtual
            nos entrega el programa el mismo día que sale el laboratorio."
          </p>
          <p className="mt-6 text-[#f4ead9]/60 font-mono-label text-sm tracking-wide">
            TÉCNICO DE CAMPO — COOPERATIVA PLATANERA, LA PALMA
          </p>
        </div>
      </Section>

      {/* Mobile app */}
      <Section className="bg-[hsl(var(--muted))]/50 border-y border-[hsl(var(--border))] overflow-hidden">
        <div className="max-w-6xl mx-auto px-5 py-28 grid md:grid-cols-2 gap-14 items-center">
          <div className="reveal-left">
            <span className="inline-flex items-center gap-2 text-xs font-mono-label tracking-[0.15em] uppercase text-[hsl(var(--primary))]"><Smartphone className="w-4 h-4" /> App móvil</span>
            <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight">La finca, en tu bolsillo</h2>
            <p className="mt-5 text-[hsl(var(--muted-foreground))] text-lg leading-relaxed">
              Consulta tus fincas, el programa vigente y las alertas desde el móvil, chatea con el
              técnico virtual delante de la planta y protege el acceso con tu huella o Face ID.
              Además, la web se instala como aplicación (PWA) en cualquier dispositivo.
            </p>
            <ul className="mt-7 space-y-3 text-[hsl(var(--foreground))]">
              {[
                ["Bloqueo biométrico opcional", Fingerprint],
                ["Misma cuenta que en la web", Users],
                ["Alertas y programa siempre a mano", Leaf],
              ].map(([t, Icon]: any) => (
                <li key={t} className="flex items-center gap-3"><Icon className="w-5 h-5 text-[hsl(var(--secondary))] shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="reveal-right flex justify-center gap-4 md:gap-6">
            <PhoneFrame src={img("movil-login.png")} alt="Acceso a la app móvil" className="w-40 md:w-52 -rotate-3 mt-8" />
            <PhoneFrame src={img("movil-home.png")} alt="Mis fincas en el móvil" className="w-40 md:w-52 rotate-2" />
          </div>
        </div>
      </Section>

      {/* Features grid */}
      <Section id="funciones" className="max-w-6xl mx-auto px-5 py-28">
        <div className="text-center reveal">
          <span className="text-xs font-mono-label tracking-[0.2em] uppercase text-[hsl(var(--secondary))]">Plataforma completa</span>
          <h2 className="mt-3 font-display text-3xl md:text-5xl font-semibold tracking-tight">Todo lo que necesita tu explotación</h2>
          <p className="mt-5 text-[hsl(var(--muted-foreground))] max-w-2xl mx-auto text-lg">
            Una sola plataforma para la nutrición, la sanidad y la documentación técnica de tus fincas.
          </p>
        </div>
        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="reveal rounded-2xl border border-[hsl(var(--card-border))] p-7 hover:shadow-xl hover:-translate-y-1 hover:border-[hsl(var(--secondary))]/40 transition-all duration-300 bg-[hsl(var(--card))]"
              data-reveal-delay={(i % 4) * 90}
            >
              <div className="w-12 h-12 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--secondary))] flex items-center justify-center">
                <f.icon className="w-5.5 h-5.5" />
              </div>
              <h3 className="mt-5 font-semibold text-lg">{f.title}</h3>
              <p className="mt-2.5 text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Pricing */}
      <Section id="precios" className="bg-[#0c1f16] text-[#f4ead9] relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_80%_10%,#2f9e68,transparent_50%)]" />
        <div className="relative max-w-6xl mx-auto px-5 py-28">
          <div className="text-center reveal">
            <span className="text-xs font-mono-label tracking-[0.2em] uppercase text-[#6fd39f]">Precios</span>
            <h2 className="mt-3 font-display text-3xl md:text-5xl font-semibold tracking-tight">Un precio simple, pensado para cooperativas</h2>
            <p className="mt-5 text-[#f4ead9]/70 max-w-2xl mx-auto text-lg">
              Cada cooperativa u OPP dispone de su propia instalación independiente, con sus datos en
              su propio servidor.
            </p>
          </div>
          <div className="reveal-scale mt-16 max-w-3xl mx-auto rounded-3xl bg-[#132a1e] border border-[#6fd39f]/25 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="bg-[#2f9e68] text-white px-8 py-5 text-center">
              <span className="font-semibold tracking-wide uppercase text-sm font-mono-label">Plan cooperativa / OPP</span>
            </div>
            <div className="px-8 py-12 grid sm:grid-cols-2 gap-10 items-center">
              <div className="text-center sm:border-r sm:border-white/10">
                <div className="font-display text-5xl font-semibold text-[#f4ead9]">100 €<span className="text-lg font-medium text-[#f4ead9]/50 font-sans">/mes</span></div>
                <p className="mt-3 text-[#f4ead9]/65">Instalación y mantenimiento: servidor dedicado, dominio, copias de seguridad, actualizaciones y soporte.</p>
              </div>
              <div className="text-center">
                <div className="font-display text-5xl font-semibold text-[#f4ead9]">2,50 €<span className="text-lg font-medium text-[#f4ead9]/50 font-sans">/finca/mes</span></div>
                <p className="mt-3 text-[#f4ead9]/65">Por cada finca activa, sin límite de sectores, analíticas ni usuarios técnicos.</p>
              </div>
            </div>
            <div className="px-8 pb-9">
              <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-[#f4ead9]/85">
                {[
                  "Instalación independiente para cada cooperativa",
                  "Web + app móvil incluidas",
                  "Usuarios y técnicos ilimitados",
                  "Copias de seguridad diarias",
                  "Actualizaciones y mejoras continuas",
                  "Consumo de OpenAI aparte, con la clave de la cooperativa y límite de gasto configurable",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-sm"><CheckCircle2 className="w-4 h-4 text-[#6fd39f] shrink-0 mt-0.5" /> {t}</li>
                ))}
              </ul>
              <div className="mt-10 text-center">
                <Link href="/contratar">
                  <Button
                    size="lg"
                    className="bg-[#2f9e68] hover:bg-[#258355] text-white font-semibold h-13 px-9 shadow-[0_10px_30px_-8px_rgba(47,158,104,0.5)] hover:-translate-y-0.5 transition-all"
                    data-testid="button-landing-cta-pricing"
                  >
                    Contratar online <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
                <p className="mt-3 text-sm text-[#f4ead9]/60 text-center">
                  Alta automática: pago por PayPal y tu instalación lista en tu propio subdominio.
                </p>
              </div>
              <p className="mt-7 text-xs text-[#f4ead9]/45 text-center leading-relaxed">
                Precios sin impuestos. Revisión de precios como máximo una vez al año, comunicada con
                60 días de antelación y limitada a IPC + 2 puntos, con derecho a resolver el contrato
                sin penalización si no se acepta. Consulta los{" "}
                <Link href="/terminos" className="text-[#6fd39f] underline underline-offset-2">términos y condiciones</Link>.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-5 py-28">
        <div className="relative rounded-3xl overflow-hidden shadow-2xl">
          <img src={ctaImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-[#0c1f16]/92 via-[#0c1f16]/80 to-[#0c1f16]/60" />
          <div className="relative px-8 py-20 text-center">
            <h2 className="font-display text-3xl md:text-5xl font-semibold tracking-tight text-[#f4ead9]">
              Empieza a abonar con datos,
              <br className="hidden md:block" /> no con intuición.
            </h2>
            <p className="mt-6 text-[#f4ead9]/75 text-lg max-w-xl mx-auto">
              Instala AgroNutri AI en tu servidor en minutos y ten a tu técnico virtual trabajando hoy mismo.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link href="/login">
                <Button
                  size="lg"
                  className="bg-[#2f9e68] hover:bg-[#258355] text-white font-semibold text-base h-13 px-9 shadow-[0_10px_30px_-8px_rgba(47,158,104,0.6)] hover:-translate-y-0.5 transition-all"
                  data-testid="button-landing-cta-bottom"
                >
                  Entrar en la plataforma <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[hsl(var(--border))]">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-8" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            AgroNutri AI — Fertirrigación y sanidad vegetal para platanera. © {new Date().getFullYear()}
          </p>
          <div className="flex items-center gap-5">
            <a href="#precios" className="text-sm font-medium text-[hsl(var(--primary))] hover:underline">Precios</a>
            <Link href="/terminos" className="text-sm font-medium text-[hsl(var(--primary))] hover:underline">
              Términos y condiciones
            </Link>
            <Link href="/login" className="text-sm font-medium text-[hsl(var(--primary))] hover:underline">
              Acceder
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
