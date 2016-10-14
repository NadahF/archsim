/* Effectively a single-cycle processor.
 * Takes as input an instruction set architecture as described below,
 *   the number of registers to instantiate this processor with,
 *   and the size in cells of the onboard memory unit.
 */
function Processor (isa, regCount, memSize) {
  /* Create the register file and memory units */
  var r = new RegisterFile(regCount);
  var m = new Memory(memSize);
  
  /* Instantiate the program counter */
  var pc = new (function () {
    var value = 0;

    this.inc = function () {
      return ++value;
    };

    this.get = function () {
      return value;
    };

    this.set = function (v) {
      value = v;
    };

    this.reset = function () {
      value = 0;
    };
  })();

  /* Instantiate the ISA with the register/memory types */
  isa = isa(r.getRegByDescriptor, m);
  
  /* Extract all the possible commands from the ISA */
  var cmds = isa.map(instr => instr.cmd);
  
  /* Instantiate the program counter */
  var pc = 0;
  
  /* These maintain the state of the currently executing program */
  var loaded = false;
  var instrs;
  
  /* Default listeners do nothing when called */
  this.onProgramLoaded = function (instrs, regs, mem) {};
  this.onProgramComplete = function (regs, mem) {};
  this.onInstructionComplete = function (instr, regs, mem) {};
  this.onDecodeComplete = function (instr) {};
  this.onError = function (err) {};
  
  /* Load a program into memory */
  this.load = function (str) {
    instrs = str.split("\n");
    /* Filter out lines containing just whitespace */
    instrs = instrs.filter(s => !(/^\s*$/.test(s)));
    set();
    this.onProgramLoaded(instrs, r, m);
    return this;
  };
  
  /* Set up the processor. This can only happen internally */
  function set () {
    loaded = true;
    pc.reset();
  }
  
  /* Reset the processor. This can only happen internally */
  function reset () {
    loaded = false;
    instrs = [];
    pc.reset();
  }
  
  /* Execute the code loaded into memory */
  this.exec = function () {
    /* If no code is loaded, abort */
    if (!loaded)
      return this.err(new ProgramNotLoadedError());
    
    /* Attempt to run the code, one instruction at a time,
     * catching and reporting any errors */
    try {
      for (var i = 0; i < instrs.length; i++)
        execInstr();
    } catch (e) {
      this.onError(e.name + " " + e.message);
      return this.err(e);
    }
    
    reset();
    
    this.onProgramComplete(r, m);
    return 0;
  };
  
  /* Execute a single instruction. This call can only happen internally
   * Var-bound so we can bind the `this` parameter */
  var execInstr = function () {
    /* Decode the instruction */
    var instr = decode(instrs[pc.get()]);
    /* Execute the decoded instruction */
    instr.dest.setValue(instr.eval(
      typeof instr.src1 == "number" || instr.src1 ? instr.src1.valueOf() : undefined,
      typeof instr.src2 == "number" || instr.src2 ? instr.src2.valueOf() : undefined
    ));
    pc++;
    this.onInstructionComplete(instr, r, m);
  }.bind(this);
  
  /* Decodes the instruction passed in. This can only happen internally
   * Var-bound to bind the `this` parameter */
  var decode = function (str) {
    /* Extract the actual instruction */
    var cmd = str.match(/^([a-z]+)\s+/);
    if (cmd == null)
      throw new IllegalInstructionError();
      
    /* Then remove it from the picture */
    str = str.replace(/^([a-z]+)\s+/, "");
      
    /* Copy the ISA entry for this instruction */
    cmd = cmd[1];
    var i = cmds.indexOf(cmd);
    if (i < 0)
      throw new InstructionNotSupportedError(cmd);
    var instr = Object.assign({}, isa[i]);
    
    /* And split the remaining instruction up into distinct operands */
    var opStr = str.split(",");

    /* Attempt to decode the instruction using one of the specified syntaxes
     * in the ISA */
    valid = 0;
    for (var j = 0; j < instr.syntax.length; j++) {
      var keys = Object.keys(instr.syntax[j]);
      if (keys.length !== opStr.length)
        continue;
      
      var err = 0;
      for (var k = 0; k < keys.length; k++) {
        instr[keys[k]] = instr.syntax[j][keys[k]](opStr[k]);
        /* If one operand failed under this syntax, the whole rule fails */
        if (
          (typeof instr[keys[k]]  == "number" && isNaN(instr[keys[k]])) ||
          instr[keys[k]] == null || instr[keys[k]] == undefined
        ) {
          err = 1;
          break;
        }
      }
      if (err) continue;
      
      valid = 1;
      break;
    }
    
    /* If we couldn't decode it, the user hasn't given a valid instruction */
    if (!valid)
      throw new IllegalInstructionError();
      
    delete instr.syntax;
    
    this.onDecodeComplete(instr);
    return instr;
  
    /* A custom error for an instruction that couldn't be decoded/executed */
    function IllegalInstructionError () {
      this.name = "Illegal Instruction:";
      this.message = instrs[pc.get()];
    }
  
    /* A custom error for an instruction that looked valid, but wasn't supported
     * by the ISA */
    function InstructionNotSupportedError (cmd) {
      this.name = "Instruction Not Supported:";
      this.message = cmd;
    }
  }.bind(this);
  
  this.err = function (e) {
    console.error(e.name, e.message);
    reset();
    return 1;
  };
  
  function ProgramNotLoadedError () {
    this.name = "Program Not Loaded:"
    this.message = "Nothing to execute."
  }
  
  /* A simple register file implementation.
   * 
   */
  function RegisterFile (regCount) {
    var r = [];
    for (var i = 0; i < regCount; i++)
      r.push(new Register());

    /* Access a particular register in the file by its descriptor, i.e. r[n] */
    this.getRegByDescriptor = function (str) {
      var m;
      /* Test to see if the input is of the right form */
      if (!/^\s*(r\[[0-9]+\])\s*$/.test(str) || (m = str.match(/([0-9]+)/)) == null)
        throw new RegisterFileError("Invalid register descriptor: " + str);
      /* If so, check that the inputted register number is within the bounds */
      if (+m[1] < 0 || +m[1] >= regCount)
        throw new RegisterFileError("Accessing a nonexistent register: r[" + +m[1] + "]");
      return r[+m[1]];
    };

    /* Access a particular register by its index */
    this.getReg = function (i) {
      if (i < 0 || i >= regCount)
        throw new RegisterFileError("Accessing a nonexistent register: r[" + i + "]");
      return r[i];
    };

    /* Retrieve the entire register file */
    this.getRegisterFile = function () {
      return r;
    };

    /* A custom error for reporting issues in the register file */
    function RegisterFileError (err) {
      this.name = "Register File Error:"
      this.message = err;
    }

    /* A VERY simplistic register implementation.
     * Can write/read just about anything.
     */
    function Register () {
      var value;

      this.setValue = function (v) {
        value = v;
      };

      this.valueOf = function () {
        return value;
      };
    };
  };

  /* An onboard memory implementation.
   * Each memory cell can store just about anything.
   * TODO: Make this more similar to RegisterFile, i.e. Memory is an array of MemoryCells,
   *       MemoryCells have setValue and valueOf() functions. Will work better with the
   *       processor.
   */
  function Memory (sz) {
    var mem = new Array(sz);

    /* Write a value to a particular memory cell */
    this.write = function (i, v) {
      if (i < 0 || i >= sz)
        throw MemoryError("Writing to a nonexistent memory location.");
      mem[i] = v;
    };

    /* Read a value from a particular memory cell */
    this.read = function (i) {
      if (i < 0 || i >= sz)
        throw MemoryErr("Reading from a nonexistent memory location.");
      return mem[i];
    };

    /* Custom error for reporting issues in the memory module */
    function MemoryError (err) {
      this.name = "Memory Error:";
      this.message = err;
    }
  };
};

/* User-defined ISA. Must be a function taking as input `Register` and `Memory`.
 * This is how we bind the ISA to the processor's onboard reg/memory instantiation. */
var isa = function (Register, Memory) {
  return [
    {
      cmd: "mov",
      desc: "Move a number constant into a register",
      syntax: [
        {
          src1: Number,
          dest: Register
        }
      ],
      eval: function (src1) {
        return src1;
      }
    },
    {
      cmd: "add",
      desc: "Add two numbers into a register",
      syntax: [
        {
          src1: Register,
          src2: Number,
          dest: Register
        },
        {
          src1: Register,
          src2: Register,
          dest: Register
        }
      ],
      eval: function (src1, src2) {
        return src1 + src2;
      }
    },
    {
      cmd: "sub",
      desc: "Subtract two numbers into a register",
      syntax: [
        {
          src1: Register,
          src2: Number,
          dest: Register
        },
        {
          src1: Register,
          src2: Register,
          dest: Register
        }
      ],
      eval: function (src1, src2) {
        return src1 - src2;
      }
    }
  ];
};

/* Create a new processor with the ISA defined above.
 * 32 registers in this processor with 1024-cell onboard memory.
 */
var proc = new Processor(isa, 12, 1024);

/* Define the onInstructionComplete listener -- executed after PC is incremented */
proc.onProgramComplete = function (r, m) {
  for (var i = 0; i < r.getRegisterFile().length; i++) {
    document.querySelector("#r" + i).textContent = r.getReg(i).valueOf();
  }
};

/* Define onError listener -- executed when there is an error anywhere in the processor. */
proc.onError = function (e) {
  document.querySelector("#err").textContent = e;
}

/* Load a user program into the processor and execute it */
function execute () {
  document.querySelector("#err").textContent = "";
  proc.load(document.querySelector("#prog").value).exec();
}