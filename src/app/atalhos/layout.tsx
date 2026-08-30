import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Atalhos — Jozep's Garage",
  description: "Ações rápidas para o atendimento",
};

export default function AtalhosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-background">
      {children}
    </div>
  );
}
