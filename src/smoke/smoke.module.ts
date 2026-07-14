import { Module } from '@nestjs/common';
import { SmokeController } from './smoke.controller';

@Module({ controllers: [SmokeController] })
export class SmokeModule {}
