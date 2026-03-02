import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { CurrentUserType } from "../types/current-user.type";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserType }>();

    if (!request.user) {
      throw new UnauthorizedException("Authenticated user not found");
    }

    return request.user;
  },
);
