import type { NextConfig } from "next";

// Этот конфиг нужен для деплоя,
// standalone - дает маденький бандл, где все только необходимое
// serverExternalPackages - говоорит что призму оставляем как внешнюю зависимости чтобы ее код не инлайнился в итоговый код бандла


const nextConfig: NextConfig = {
  // Меньший образ для Layero/контейнера. Безвредно для `next start`.
  output: "standalone",
  // Prisma не должен инлайниться бандлером на сервере.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
