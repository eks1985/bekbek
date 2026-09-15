import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Меньший образ для Layero/контейнера. Безвредно для `next start`.
  output: "standalone",
  // Prisma не должен инлайниться бандлером на сервере.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
