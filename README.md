# Lead Nurturing Automation

A Node.js-based lead nurturing automation system that integrates with CRM systems and orchestrates multi-channel communication through n8n workflows.

## Features

- **CRM Integration**: Read-only integration with CRM systems to capture product login events
- **Lead Management**: External lead tracking with stage progression and engagement scoring
- **Multi-Channel Communication**: Email, WhatsApp, and chatbot integration
- **n8n Orchestration**: Workflow automation platform for coordinating all processes
- **Analytics & Reporting**: Performance metrics and conversion tracking

## Architecture

The system follows a microservices architecture with:
- **Lead Tracker**: Core lead management and progression tracking
- **Communication Engine**: Multi-channel message delivery
- **n8n Workflows**: Orchestration and automation logic
- **Analytics Dashboard**: Performance monitoring and reporting

## Prerequisites

- Node.js 16+ 
- PostgreSQL 12+
- n8n (self-hosted or cloud)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure your database and other services in `.env`

5. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for all available configuration options.

## Testing

Run tests:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

Run tests in watch mode:
```bash
npm run test:watch
```

## API Endpoints

### Health Check
- `GET /health` - System health status

### Lead Management (Coming Soon)
- `POST /leads` - Create new lead
- `PUT /leads/:id` - Update lead information
- `GET /leads/:id` - Retrieve lead details
- `POST /leads/:id/events` - Record engagement event

### Communication (Coming Soon)
- `POST /messages/send` - Send message via specified channel
- `GET /messages/:id/status` - Check delivery status

## Development

The project uses:
- **Express.js** for the web framework
- **PostgreSQL** with connection pooling for data storage
- **Winston** for logging
- **Jest** for unit testing
- **fast-check** for property-based testing

## License

MIT