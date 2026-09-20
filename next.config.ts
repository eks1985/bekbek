import type { NextConfig } from "next";

// Этот конфиг нужен для деплоя,
// standalone - дает маденький бандл, где все только необходимое
// serverExternalPackages - говоорит что призму оставляем как внешнюю зависимости чтобы ее код не инлайнился в итоговый код бандла


const nextConfig: NextConfig = {
  // Меньший образ для Layero/контейнера. Безвредно для `next start`.
  output: "standalone",
  // Prisma и FIT SDK не должны инлайниться бандлером на сервере
  // (оба — большие CJS-пакеты, работают только на Node).
  serverExternalPackages: ["@prisma/client", "@garmin/fitsdk"],
};

export default nextConfig;
