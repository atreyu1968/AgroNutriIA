import { Link } from "wouter";
import { SignupForm } from "@/components/signup-form";
import { Leaf } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

export default function Contratar() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 via-white to-white text-gray-900">
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/landing"><img src={`${BASE}logo.png`} alt="AgroNutri AI" className="h-9" /></Link>
          <Link href="/landing" className="text-sm font-medium text-green-700 hover:underline">Volver a la web</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-green-800 bg-green-100 rounded-full px-4 py-1.5">
            <Leaf className="w-4 h-4" /> Plan cooperativa / OPP
          </span>
          <h1 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight">Contrata tu instalación</h1>
          <p className="mt-3 text-gray-600 max-w-xl mx-auto">
            100 €/mes por instalación + 2,50 €/finca activa/mes. Tu cooperativa tendrá su propia
            instalación independiente en <strong>tusubdominio</strong>.agronutri, con alta automática
            tras el pago por PayPal.
          </p>
        </div>

        <SignupForm />
      </main>
    </div>
  );
}
