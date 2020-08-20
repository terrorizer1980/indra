import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { ChannelRepository } from "../channel/channel.repository";
import { ConfigModule } from "../config/config.module";

import { AuthService } from "./auth.service";
import { messagingAuthProviderFactory } from "./auth.provider";
import { AuthController } from "./auth.controller";

@Module({
  controllers: [AuthController],
  exports: [AuthService, messagingAuthProviderFactory],
  imports: [TypeOrmModule.forFeature([ChannelRepository]), ConfigModule],
  providers: [AuthService, messagingAuthProviderFactory],
})
export class AuthModule {}
