# ---- Stage 1: dependências ------------------------------------------------
# Instala só as dependências de produção, numa camada separada.
# Se package.json não mudar, o Docker reaproveita esta camada no cache.
FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:24-alpine

WORKDIR /app

# A imagem oficial do Node já traz um usuário não-root chamado "node".
# Rodar como root em container é um achado clássico de auditoria de segurança.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "src/index.js"]
#test4