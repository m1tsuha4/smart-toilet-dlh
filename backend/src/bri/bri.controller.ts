import {
  Body,
  Controller,
  Headers,
  HttpException,
  InternalServerErrorException,
  Post,
  Res,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BriService } from './bri.service';
import { ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { SkipResponseTransform } from '../common/decorators/skip-response-transform.decorator';

@Controller('bri')
export class BriController {
  constructor(private readonly briService: BriService) {}

  @Post('generate-qr')
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: { deviceCode: { type: 'string', example: 'GATE-001' } },
    },
  })
  async generateQR(@Body('deviceCode') deviceCode?: string) {
    return this.briService.generateQR(deviceCode);
  }

  @Post('inquiry')
  @ApiBody({
      description: 'Inquiry Request',
      schema: {
        example: {
          partnerReferenceNo: '1234567890',
        },
      },
    })
  @ApiOkResponse({
    description: 'Inquiry successfully',
  })
  inquiry(@Body('partnerReferenceNo') partnerReferenceNo: string) {
    return this.briService.inquiry(partnerReferenceNo);
  }
}

@Controller()
export class BriWebhookController {
  constructor(private readonly briService: BriService) {}

  @Post('v1.1/qr-dynamic/qr-mpm-notify')
  @SkipResponseTransform()
  async notify(
    @Body() body: Record<string, unknown>,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
    @Headers('x-signature') signature?: string,
    @Headers('x-timestamp') timestamp?: string,
    @Headers('authorization') authorization?: string,
  ) {
    console.log({
      hasRawBody: !!request.rawBody,
      rawBodyLength: request.rawBody?.length,
      hasSignature: !!signature,
      hasTimestamp: !!timestamp,
      hasAuthorization: !!authorization,
    });
    try {
      await this.briService.handleNotification(body, signature, {
        rawBody: request.rawBody,
        timestamp,
        authorization,
      });

      return response.status(200).json({
        responseCode: '2005200',
        responseMessage: 'Successful',
        AdditionalInfo:
          body.additionalInfo &&
          typeof body.additionalInfo === 'object' &&
          !Array.isArray(body.additionalInfo)
            ? body.additionalInfo
            : {},
      });
    } catch (error) {
      const status =
        error instanceof HttpException ? error.getStatus() : 500;
      const exceptionResponse =
        error instanceof HttpException ? error.getResponse() : undefined;
      const exceptionMessage =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as { message?: string | string[] }).message
          : undefined;
      const detail = Array.isArray(exceptionMessage)
        ? exceptionMessage[0]
        : exceptionMessage ??
          (error instanceof Error ? error.message : 'Unexpected error');

      let responseCode = `${status}5200`;
      let responseMessage = detail;

      if (status === 400) {
        const missingMandatoryField = /required|mandatory/i.test(detail);
        responseCode = missingMandatoryField ? '4005202' : '4005201';
        responseMessage = missingMandatoryField
          ? 'Invalid Mandatory Field'
          : 'Invalid Field Format';
      } else if (status === 500) {
        const internalError = error instanceof InternalServerErrorException;
        responseCode = internalError ? '5005201' : '5005200';
        responseMessage = internalError
          ? 'Internal Server Error'
          : 'General Error';
      } else if (status === 504) {
        responseCode = '5045200';
        responseMessage = 'Timeout';
      }

      return response.status(status).json({
        responseCode,
        responseMessage,
        AdditionalInfo: {},
      });
    }
  }

  @Post('snap/v1.1/access-token/b2b')
  @SkipResponseTransform()
  getAccessToken() {
    return this.briService.getAccessTokenResponse();
  }
}
