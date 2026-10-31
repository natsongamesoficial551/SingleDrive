import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(400).json({ code: 'INVALID_INPUT', message: 'Dados inválidos.' })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return res.status(404).json({ code: 'NOT_FOUND', message: 'Recurso não encontrado.' })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ code: 'CONFLICT', message: 'Não foi possível concluir esta operação.' })
  return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Não foi possível concluir esta operação.' })
}
