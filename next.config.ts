import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // SheetJS (xlsx) NO debe ir dentro del bundle del server: al empaquetarlo
  // queda sin el módulo cptable (codepages) y XLSX.read explota con
  // "Cannot read properties of undefined (reading 'utils')" en CSV UTF-16/UTF-8
  // con caracteres especiales y en otros formatos de texto. Externo = se usa
  // node_modules como en node puro, donde funciona.
  serverExternalPackages: ["xlsx"],
};

export default nextConfig;
