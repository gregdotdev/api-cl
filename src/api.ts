import express, { Request, Response } from 'express';
import { Client, TextChannel, DMChannel } from 'discord.js-selfbot-v13';
import WebSocket from 'ws';
import http from 'http';

const wss = new WebSocket.Server({ noServer: true });
let currentWsClient: WebSocket | null = null;

const broadcast = (message: string) => {
  if (currentWsClient && currentWsClient.readyState === WebSocket.OPEN) {
    currentWsClient.send(message);
  }
};

interface ClearMessageOptions {
  limit?: number | false;
  directionTopDown?: boolean;
  onlyUserMessages?: boolean;
}

const clearMessages = async (
  token: string,
  id: string,
  options: ClearMessageOptions = {}
): Promise<void> => {
  const {
    limit = false,
    directionTopDown = true, // Configurado para deletar de cima para baixo
    onlyUserMessages = true
  } = options;

  const client = new Client({});
  return new Promise((resolve, reject) => {
    client.once('ready', async () => {
      try {
        let channel: TextChannel | DMChannel | null = null;
        try {
          const user = await client.users.fetch(id);
          channel = await user.createDM();
        } catch {
          try {
            channel = await client.channels.fetch(id) as TextChannel;
          } catch {
            broadcast('[x] Canal ou usuário inválido.');
            reject(new Error('Canal ou usuário inválido.'));
            return;
          }
        }
        if (!channel || !channel.isText()) {
          broadcast('[x] Canal ou usuário inválido.');
          reject(new Error('Canal ou usuário inválido.'));
          return;
        }

        let deletedCount = 0;
        let hasMore = true;
        let lastMessageId: string | undefined;

        while (hasMore) {
          const fetchOptions = {
            limit: 100,
            ...(lastMessageId && !directionTopDown
              ? { before: lastMessageId }
              : (lastMessageId && directionTopDown
                ? { after: lastMessageId }
                : {})
            )
          };

          const messages = await channel.messages.fetch(fetchOptions);

          if (messages.size === 0) {
            hasMore = false;
            break;
          }

          const messagesToDelete = Array.from(messages.values())
            .filter(msg =>
              (!onlyUserMessages || msg.author.id === client.user?.id) &&
              (limit === false || deletedCount < limit)
            );

          for (const msg of messagesToDelete) {
            await msg.delete();
            deletedCount++;
            broadcast(`Mensagem apagada: ${msg.content}`);
          }

          if (!directionTopDown) {
            lastMessageId = messages.last()?.id;
          } else {
            lastMessageId = messages.first()?.id;
          }

          if ((limit !== false && deletedCount >= limit) || messages.size < 100) {
            hasMore = false;
          }
        }

        broadcast(`${deletedCount} mensagens apagadas com sucesso!`);
        client.destroy();
        resolve();
      } catch (error) {
        console.error('Erro ao apagar mensagens:', error);
        broadcast('[x] Erro ao apagar mensagens.');
        client.destroy();
        reject(error);
      }
    });
    client.login(token).catch(reject);
  });
};

const app = express();
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('API de apagar mensagens no Discord');
});

wss.on('connection', (ws) => {
  currentWsClient = ws;
  ws.on('close', () => {
    currentWsClient = null;
  });
});

const clearMessagesHandler = async (req: Request, res: Response): Promise<void> => {
  const {
    token,
    id,
    limit = false,
    directionTopDown = true, // Configurado para deletar de cima para baixo
    onlyUserMessages = true
  } = req.body;

  if (!token || !id) {
    res.status(400).json({ error: 'Token ou ID não fornecido.' });
    return;
  }

  try {
    await clearMessages(token, id, { limit, directionTopDown, onlyUserMessages });
    res.status(200).json({
      message: `${limit === false ? 'Todas as' : limit} mensagens apagadas com sucesso!`
    });
  } catch (error) {
    console.error('Erro ao apagar mensagens:', error);
    res.status(500).json({ error: 'Erro interno ao tentar apagar mensagens.' });
  }
};

app.post('/clear-messages', clearMessagesHandler);

const server = http.createServer(app);

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(3003, () => {
  console.log('Servidor rodando na porta 3003');
});