import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitDto } from './dto/create-visit.dto';

@Injectable()
export class VisitService {
  constructor(private prisma: PrismaService) {}

  async sendVisit(senderId: string, dto: CreateVisitDto) {
    if (senderId === dto.receiverId) {
      throw new ForbiddenException('Cannot send visit to yourself');
    }

    const friendship = await this.prisma.friendship.findFirst({
      where: {
        userId: senderId,
        friendId: dto.receiverId,
      },
    });

    if (!friendship) {
      throw new ForbiddenException('Can only send visits to friends');
    }

    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: dto.receiverId },
          { blockerId: dto.receiverId, blockedId: senderId },
        ],
      },
    });

    if (blocked) {
      throw new ForbiddenException('Cannot send visit to this user');
    }

    const visit = await this.prisma.visit.create({
      data: {
        senderId,
        receiverId: dto.receiverId,
        content: dto.content,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return visit;
  }

  async getInbox(userId: string) {
    const visits = await this.prisma.visit.findMany({
      where: {
        receiverId: userId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return visits;
  }

  async getOutbox(userId: string) {
    const visits = await this.prisma.visit.findMany({
      where: {
        senderId: userId,
      },
      include: {
        receiver: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return visits;
  }

  async getHistory(userId: string) {
    const visits = await this.prisma.visit.findMany({
      where: {
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return visits;
  }

  async acceptVisit(userId: string, visitId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.receiverId !== userId) {
      throw new ForbiddenException('Not authorized to accept this visit');
    }

    if (visit.status !== 'pending') {
      throw new ForbiddenException('Visit already processed');
    }

    const updatedVisit = await this.prisma.visit.update({
      where: { id: visitId },
      data: { status: 'accepted' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return updatedVisit;
  }

  async dismissVisit(userId: string, visitId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.receiverId !== userId) {
      throw new ForbiddenException('Not authorized to dismiss this visit');
    }

    if (visit.status !== 'pending') {
      throw new ForbiddenException('Visit already processed');
    }

    const updatedVisit = await this.prisma.visit.update({
      where: { id: visitId },
      data: { status: 'dismissed' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    return updatedVisit;
  }

  async getPendingVisits(userId: string) {
    const visits = await this.prisma.visit.findMany({
      where: {
        receiverId: userId,
        status: 'pending',
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return visits;
  }
}
