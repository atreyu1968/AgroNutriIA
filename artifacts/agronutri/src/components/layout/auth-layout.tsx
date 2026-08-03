import plantacionImg from "@/assets/plataneras-canarias.jpg";

const logoUrl = `${import.meta.env.BASE_URL}logo.png`;
const logoBlancoUrl = `${import.meta.env.BASE_URL}logo-blanco.png`;

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Panel izquierdo: plataneras de Canarias (solo en pantallas medianas o más) */}
      <div className="hidden lg:block relative w-1/2 xl:w-[55%]">
        <img
          src={plantacionImg}
          alt="Plantación de plataneras en Canarias"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/30" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <img src={logoBlancoUrl} alt="AgroNutri AI" className="h-12 w-auto mb-4 drop-shadow" />
          <p className="text-white/90 text-lg max-w-md drop-shadow">
            Sistema Inteligente de Precisión para el Cultivo de Platanera
          </p>
        </div>
      </div>

      {/* Panel derecho: formulario */}
      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
          <div className="flex justify-center mb-4">
            <img src={logoUrl} alt="AgroNutri AI" className="h-14 sm:h-16 w-auto" />
          </div>
          <p className="text-center text-sm text-muted-foreground lg:hidden">
            Sistema Inteligente de Precisión para el Cultivo de Platanera
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
          <div className="bg-card py-8 px-4 shadow-xl shadow-foreground/5 sm:rounded-xl sm:px-10 border border-card-border">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
