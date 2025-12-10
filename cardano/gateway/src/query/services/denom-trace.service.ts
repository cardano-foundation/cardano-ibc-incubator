import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DenomTrace } from '../../shared/entities/denom-trace.entity';
import { PaginationKeyDto } from '../dtos/pagination.dto';

@Injectable()
export class DenomTraceService {
  constructor(
    private readonly logger: Logger,
    @InjectRepository(DenomTrace)
    private denomTraceRepository: Repository<DenomTrace>,
  ) {}

  /**
   * Save or update a denom trace mapping
   * Uses upsert to avoid duplicate entries
   */
  async saveDenomTrace(trace: Partial<DenomTrace>): Promise<DenomTrace> {
    try {
      // Check if trace already exists
      const existing = await this.denomTraceRepository.findOne({
        where: { hash: trace.hash },
      });

      if (existing) {
        this.logger.log(`Denom trace already exists for hash: ${trace.hash}`);
        return existing;
      }

      const newTrace = this.denomTraceRepository.create(trace);
      const saved = await this.denomTraceRepository.save(newTrace);
      this.logger.log(`Saved new denom trace: ${trace.hash} -> ${trace.path}/${trace.base_denom}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to save denom trace: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a denom trace by its hash (voucher token name)
   */
  async findByHash(hash: string): Promise<DenomTrace | null> {
    try {
      const trace = await this.denomTraceRepository.findOne({
        where: { hash },
      });
      return trace;
    } catch (error) {
      this.logger.error(`Failed to find denom trace by hash ${hash}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find all denom traces with optional pagination
   */
  async findAll(pagination?: PaginationKeyDto): Promise<DenomTrace[]> {
    try {
      const query = this.denomTraceRepository
        .createQueryBuilder('denom_trace')
        .orderBy('denom_trace.first_seen', 'DESC');

      if (pagination?.offset) {
        query.offset(pagination.offset);
        query.limit(100); // Default limit
      } else {
        query.limit(100); // Default limit
      }

      const traces = await query.getMany();
      this.logger.log(`Retrieved ${traces.length} denom traces`);
      return traces;
    } catch (error) {
      this.logger.error(`Failed to find all denom traces: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find denom traces by base denomination
   */
  async findByBaseDenom(baseDenom: string): Promise<DenomTrace[]> {
    try {
      const traces = await this.denomTraceRepository.find({
        where: { base_denom: baseDenom },
        order: { first_seen: 'DESC' },
      });
      this.logger.log(`Found ${traces.length} denom traces for base denom: ${baseDenom}`);
      return traces;
    } catch (error) {
      this.logger.error(`Failed to find denom traces by base denom ${baseDenom}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get count of all denom traces
   */
  async getCount(): Promise<number> {
    try {
      return await this.denomTraceRepository.count();
    } catch (error) {
      this.logger.error(`Failed to get denom trace count: ${error.message}`);
      throw error;
    }
  }
}
