# WebDesignCLAUDE.md — Regras de Frontend para Website

## Fazer Sempre em Primeiro Lugar
- **Invocar a skill `frontend-design`** antes de escrever qualquer código frontend, em todas as sessões, sem excepções.

## Imagens de Referência
- Se for fornecida uma imagem de referência: replicar o layout, espaçamento, tipografia e cores com exactidão. Trocar por conteúdo genérico (imagens via `https://placehold.co/`, textos neutros). Não melhorar nem acrescentar ao design.
- Se não houver imagem de referência: criar de raiz com alto nível de qualidade (ver regras anti-genérico abaixo).
- Tirar screenshot do resultado, comparar com a referência, corrigir diferenças, tirar novo screenshot. Fazer pelo menos 2 rondas de comparação. Só parar quando não houver diferenças visíveis ou o utilizador disser para parar.

## Servidor Local
- **Servir sempre em localhost** — nunca tirar screenshot de um URL `file:///`.
- Iniciar o servidor de desenvolvimento: `node serve.mjs` (serve a raiz do projecto em `http://localhost:3000`)
- O ficheiro `serve.mjs` encontra-se na raiz do projecto. Iniciá-lo em segundo plano antes de tirar qualquer screenshot.
- Se o servidor já estiver a correr, não iniciar uma segunda instância.

## Fluxo de Screenshots
- O Puppeteer está instalado em `C:/Users/nateh/AppData/Local/Temp/puppeteer-test/`. A cache do Chrome está em `C:/Users/nateh/.cache/puppeteer/`.
- **Tirar sempre screenshot a partir do localhost:** `node screenshot.mjs http://localhost:3000`
- Os screenshots são guardados automaticamente em `./temporary screenshots/screenshot-N.png` (auto-incrementado, nunca sobrescrito).
- Sufixo de etiqueta opcional: `node screenshot.mjs http://localhost:3000 etiqueta` → guarda como `screenshot-N-etiqueta.png`
- O ficheiro `screenshot.mjs` encontra-se na raiz do projecto. Usar tal como está.
- Após tirar o screenshot, ler o PNG de `temporary screenshots/` com a ferramenta Read — o Claude consegue ver e analisar a imagem directamente.
- Ao comparar, ser específico: "o título está a 32px mas a referência mostra ~24px", "o espaçamento entre cards é 16px mas deveria ser 24px"
- Verificar: espaçamento/padding, tamanho/peso/line-height da fonte, cores (hex exacto), alinhamento, border-radius, sombras, tamanho de imagens

## Padrões de Output
- Ficheiro único `index.html`, todos os estilos inline, salvo indicação contrária do utilizador
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Imagens placeholder: `https://placehold.co/LARGURAxALTURA`
- Mobile-first e responsivo

## Assets de Marca
- Verificar sempre a pasta `brand_assets/` antes de desenhar. Pode conter logos, guias de cor, guias de estilo ou imagens.
- Se existirem assets, usá-los. Não usar placeholders onde existem assets reais.
- Se houver um logo, usá-lo. Se houver uma paleta de cores definida, usar esses valores exactos — não inventar cores de marca.

## Regras Anti-Genérico
- **Cores:** Nunca usar a paleta padrão do Tailwind (indigo-500, blue-600, etc.). Definir uma cor de marca personalizada e derivar a partir dela.
- **Sombras:** Nunca usar `shadow-md` plano. Usar sombras em camadas, com tonalidade de cor e baixa opacidade.
- **Tipografia:** Nunca usar a mesma fonte em títulos e corpo. Combinar uma fonte de exibição/serif com uma sans-serif limpa. Aplicar kerning apertado (`-0.03em`) em títulos grandes, line-height generosa (`1.7`) no corpo.
- **Gradientes:** Sobrepor múltiplos gradientes radiais. Adicionar grão/textura via filtro de ruído SVG para dar profundidade.
- **Animações:** Animar apenas `transform` e `opacity`. Nunca usar `transition-all`. Usar easing estilo mola (spring).
- **Estados interactivos:** Todo o elemento clicável precisa de estados hover, focus-visible e active. Sem excepções.
- **Imagens:** Adicionar overlay de gradiente (`bg-gradient-to-t from-black/60`) e uma camada de tratamento de cor com `mix-blend-multiply`.
- **Espaçamento:** Usar tokens de espaçamento intencionais e consistentes — não passos aleatórios do Tailwind.
- **Profundidade:** As superfícies devem ter um sistema de camadas (base → elevada → flutuante), não estar todas no mesmo plano visual.

## Regras Absolutas
- Não adicionar secções, funcionalidades ou conteúdo que não esteja na referência
- Não "melhorar" um design de referência — replicá-lo
- Não parar após uma única ronda de screenshot
- Não usar `transition-all`
- Não usar o azul/indigo padrão do Tailwind como cor primária
