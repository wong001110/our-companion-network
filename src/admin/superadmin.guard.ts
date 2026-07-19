import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuperadminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException();

    // Deliberately re-read the authoritative role for every admin request.
    // A stale JWT role claim can therefore never preserve revoked privileges.
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!current) throw new UnauthorizedException();
    if (current.role !== 'SUPERADMIN') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_REQUIRED',
        message: 'Superadmin access is required',
      });
    }
    return true;
  }
}
