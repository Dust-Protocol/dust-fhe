"use client";

import { useState } from "react";
import { CofheProvider, createCofheConfig } from "@cofhe/react";
import { createCofheClient } from "@cofhe/sdk/web";
import { arbSepolia } from "@cofhe/sdk/chains";
import { QueryClient } from "@tanstack/react-query";

const cofheConfig = createCofheConfig({
  supportedChains: [arbSepolia],
});

export default function FHEProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [cofheClient] = useState(() => createCofheClient(cofheConfig));

  return (
    <CofheProvider
      config={cofheConfig}
      cofheClient={cofheClient}
      queryClient={queryClient}
    >
      {children}
    </CofheProvider>
  );
}
