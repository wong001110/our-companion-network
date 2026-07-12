import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';
import { CommonModule } from '../common/common.module';

@Module({ imports: [CommonModule], controllers: [MetaController] })
export class MetaModule {}
