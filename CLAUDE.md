# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- Frontend: `cd frontend && npm start` - Starts Vite dev server
- Backend: `cd backend && npm start` - Starts Node.js server
- Development: `cd backend && npm run dev` - Starts with nodemon auto-reload
- Docker: `docker-compose up -d` - Starts all services
- Docker Stop: `docker-compose down` - Stops all services

## Code Style Guidelines
- Indentation: 2 spaces
- Use modern ES6+ JavaScript with modular structure
- Arrow functions for callbacks, traditional functions for named exports
- Constants should be UPPERCASE
- Use JSDoc comments for all functions
- Implement try/catch for robust error handling
- Follow existing naming patterns: camelCase for variables/functions, PascalCase for classes
- State management through module-scoped variables with clean exports
- Responsive code with clear mobile/desktop viewport handling
- Dark/light theme support using CSS variables