import { JozepsLogo } from "@/components/ui/jozeps-logo";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="flex w-full flex-col justify-center bg-background px-6 py-12 sm:px-12 lg:w-1/2 lg:px-16">
      <div className="mx-auto w-full max-w-md">
        {/* Aqui o fundo é claro, então a marca fica escura. */}
        <div className="mb-8 lg:hidden">
          <JozepsLogo className="w-56 text-primary" />
        </div>

        <div className="mb-8">
          <h2 className="page-title text-2xl sm:text-3xl">{title}</h2>
          <p className="page-subtitle mt-2">{subtitle}</p>
        </div>

        <div className="card-surface">{children}</div>
      </div>
    </div>
  );
}
