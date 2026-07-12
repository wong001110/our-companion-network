import { IsString, IsObject, IsOptional } from 'class-validator';

export class CreateVisitDto {
  @IsString()
  receiverId: string;

  @IsObject()
  content: Record<string, any>;

  @IsString()
  @IsOptional()
  message?: string;
}
