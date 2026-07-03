# Deploy interno — VM Ubuntu

Portal-Saldo é um app **TanStack Start (SSR) + Nitro**. O build **precisa** usar o
preset `node-server` (o default do projeto é Cloudflare, que **não roda** por não
suportar `mssql`/TCP). Use sempre `bun run build:node` (ou `NITRO_PRESET=node-server`).

O resultado é um servidor Node standalone em `.output/server/index.mjs`, que escuta
em `PORT` (default `3000`).

---

## 1. Pré-requisitos na VM

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun (mesmo lockfile do projeto)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # ou reabrir o shell
```

Rede: a VM precisa alcançar o **SQL Server** (porta 1433) e o banco `PORTAL_CLIENTE`.
Teste: `nc -vz IP_DO_SQLSERVER 1433`.

---

## 2. Obter o código

```bash
sudo mkdir -p /opt/portal-saldo && sudo chown $USER /opt/portal-saldo
git clone <URL_DO_REPO> /opt/portal-saldo
cd /opt/portal-saldo/inventory-view-now   # ajuste se o repo já for a raiz do app
```

---

## 3. Configurar acesso ao banco

Crie `.env` **na pasta do app** (mesmo dir de onde o serviço roda — o app lê
`.env`/`.env.local` do `cwd`):

```bash
cat > .env <<'EOF'
SQLSERVER_HOST=ip-ou-nome-do-sqlserver
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=nome_do_banco_estoque
SQLSERVER_USER=usuario_sql
SQLSERVER_PASSWORD=senha
SQLSERVER_ENCRYPT=false
SQLSERVER_TRUST_CERTIFICATE=true
EOF
chmod 600 .env
```

O usuário SQL precisa de `SELECT` em `king_estoque_disponiel`, `PRODUTOS_TAMANHOS`
e cross-database em `PORTAL_CLIENTE.dbo.B2B_PRODUTO` / `B2B_POLITICA_COMERCIAL`.

---

## 4. Instalar e buildar

```bash
bun install
bun run build:node
```

Testar antes de virar serviço:

```bash
PORT=3000 bun run start        # ou: node .output/server/index.mjs
# acessar http://IP_DA_VM:3000
```

---

## 5. Rodar como serviço (systemd)

```bash
sudo tee /etc/systemd/system/portal-saldo.service >/dev/null <<'EOF'
[Unit]
Description=Portal-Saldo (estoque interno)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/portal-saldo/inventory-view-now
ExecStart=/usr/bin/node .output/server/index.mjs
Environment=PORT=3000
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R www-data:www-data /opt/portal-saldo/inventory-view-now
sudo systemctl daemon-reload
sudo systemctl enable --now portal-saldo
sudo systemctl status portal-saldo
```

Logs: `journalctl -u portal-saldo -f`

> `.env` precisa ser legível pelo user `www-data` (ajuste dono/permite se trocar de user).

---

## 6. Firewall (só rede interna)

```bash
sudo ufw allow from 10.0.0.0/8 to any port 3000 proto tcp   # ajuste a faixa da sua rede
sudo ufw enable
```

---

## 7. (Opcional) nginx na porta 80 + nome amigável

```bash
sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/portal-saldo >/dev/null <<'EOF'
server {
    listen 80;
    server_name portal-saldo.interno;   # ou o IP da VM

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/portal-saldo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Com nginx: libere 80 no ufw em vez de 3000, e feche 3000 pro externo.

---

## 8. Atualizar versão

```bash
cd /opt/portal-saldo
git pull
cd inventory-view-now
bun install
bun run build:node
sudo systemctl restart portal-saldo
```

---

## Notas

- A query de estoque roda subqueries `EXISTS` (uma por tipo de política) por linha,
  com `TOP 50000`. Se ficar lento, indexe no SQL Server:
  `B2B_PRODUTO(PRODUTO, COR)` e `B2B_POLITICA_COMERCIAL(ID_POLITICA_COMERCIAL, TIPO_ACESSO, STATUS)`.
- App faz auto-refresh a cada 30s no navegador; cada refresh reconsulta o banco.
- Sem autenticação: mantenha exposto **só na rede interna**.
