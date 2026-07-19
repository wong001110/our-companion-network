import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';

describe('RegisterDto role isolation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('rejects a registration payload that attempts to set SUPERADMIN', async () => {
    await expect(pipe.transform({
      email: 'user@example.test',
      username: 'User',
      password: 'password123',
      deviceId: '123e4567-e89b-42d3-a456-426614174000',
      role: 'SUPERADMIN',
    }, {
      type: 'body',
      metatype: RegisterDto,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the unchanged public registration contract without a role', async () => {
    await expect(pipe.transform({
      email: 'user@example.test',
      username: 'User',
      password: 'password123',
      deviceId: '123e4567-e89b-42d3-a456-426614174000',
    }, {
      type: 'body',
      metatype: RegisterDto,
    })).resolves.toBeInstanceOf(RegisterDto);
  });
});
