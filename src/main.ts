import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { BrowserSecurityService } from './common/browser-security.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const browserSecurity = app.get(BrowserSecurityService);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || browserSecurity.isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by CORS'), false);
    },
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token'],
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
