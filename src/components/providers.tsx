'use client'

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // staleTime alto: los datos del dashboard solo cambian cuando se sube
          // informacion nueva (y el server ademas cachea los agregados). Con 10
          // minutos evitamos re-consultas innecesarias al cambiar de pestana.
          queries: { staleTime: 600_000, gcTime: 3_600_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
