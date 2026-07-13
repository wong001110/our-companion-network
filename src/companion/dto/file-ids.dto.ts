import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class FileIdsDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) fileIds: string[];
}
